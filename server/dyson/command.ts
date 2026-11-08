/**
 * Change the purifier's settings through Dyson's cloud: one STATE-SET command
 * on its command topic, then the purifier's own STATE-CHANGE to confirm it.
 * The format matches hass-dyson's, which drives many cloud-connected Dyson
 * models: {"msg": "STATE-SET", "time", "mode-reason": "RAPP", "data": {...}}.
 */

import { cloudClientOptions, cloudUrl, type CloudAuth } from "./cloud";
import { cloudSession } from "./live";
import { CURRENT_STATE, isFields, newest, STATE_CHANGE, type Fields } from "./messages";
import { commandTime, defaultConnect, SnapshotError, type ConnectFn } from "./snapshot";

/** What can be changed, in the dashboard's terms. */
export interface PurifierChanges {
  power?: boolean;
  /** Let the purifier set its own speed from what it measures. */
  auto?: boolean;
  /** 1 to 10. Turns auto off, as picking a speed in the MyDyson app does. */
  fanSpeed?: number;
  nightMode?: boolean;
  /** Minutes until it turns off: 0 cancels, otherwise 15 to 540. */
  sleepTimer?: number;
  /** Keep measuring while the fan is off. */
  monitoring?: boolean;
}

export const SLEEP_TIMER_MAX = 540;

const flag = (on: boolean) => (on ? "ON" : "OFF");
const padded = (value: number) => String(value).padStart(4, "0");

/** The STATE-SET data for some changes, in the purifier's own fields. */
export function stateSetData(changes: PurifierChanges): Record<string, string> {
  const data: Record<string, string> = {};
  if (changes.power !== undefined) data.fpwr = flag(changes.power);
  if (changes.fanSpeed !== undefined) {
    data.fnsp = padded(changes.fanSpeed);
    data.auto = "OFF";
  }
  // An explicit auto wins over the one a speed implies.
  if (changes.auto !== undefined) data.auto = flag(changes.auto);
  if (changes.nightMode !== undefined) data.nmod = flag(changes.nightMode);
  if (changes.sleepTimer !== undefined) {
    data.sltm = changes.sleepTimer === 0 ? "OFF" : padded(changes.sleepTimer);
  }
  if (changes.monitoring !== undefined) data.rhtm = flag(changes.monitoring);
  return data;
}

export interface CommandResult {
  /** True once the purifier reported every requested value back. */
  confirmed: boolean;
  /** The values it reported back, by field. */
  reported: Fields;
}

export interface CommandOptions {
  auth: CloudAuth;
  serial: string;
  topicRoot: string;
  data: Record<string, string>;
  connect?: ConnectFn;
  /** How long to wait for the purifier to confirm. */
  timeoutMs?: number;
  now?: () => Date;
}

/**
 * Send one STATE-SET and wait for the purifier to report the new values. A
 * purifier that doesn't confirm in time may still have applied the change,
 * so that resolves with confirmed false rather than failing.
 */
export function sendStateSet(options: CommandOptions): Promise<CommandResult> {
  const { auth, serial, topicRoot, data, connect = defaultConnect, timeoutMs = 8_000 } = options;
  const now = options.now ?? (() => new Date());
  const statusTopic = `${topicRoot}/${serial}/status/current`;
  const commandTopic = `${topicRoot}/${serial}/command`;
  const waiting = new Map(Object.entries(data).map(([key, value]) => [key, value.toUpperCase()]));
  const reported: Fields = {};

  return new Promise<CommandResult>((resolve, reject) => {
    const client = connect(cloudUrl(auth), cloudClientOptions(auth));
    let settled = false;
    const finish = (result: CommandResult | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.end(true);
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const timer = setTimeout(() => finish({ confirmed: false, reported }), timeoutMs);

    client.on("connect", () => {
      client.subscribe([statusTopic], error => {
        if (error) {
          finish(new SnapshotError(`Dyson's cloud refused the subscription (${error.message})`));
          return;
        }
        const message = { msg: "STATE-SET", time: commandTime(now()), "mode-reason": "RAPP", data };
        client.publish(commandTopic, JSON.stringify(message));
      });
    });

    client.on("message", (_topic, payload) => {
      let message: unknown;
      try {
        message = JSON.parse(payload.toString("utf8"));
      } catch {
        return;
      }
      if (!isFields(message) || (message.msg !== STATE_CHANGE && message.msg !== CURRENT_STATE)) return;
      const fields = message["product-state"];
      if (!isFields(fields)) return;
      for (const [key, raw] of Object.entries(fields)) {
        if (!(key in data)) continue;
        const value = newest(raw);
        reported[key] = value;
        if (String(value).toUpperCase() === waiting.get(key)) waiting.delete(key);
      }
      if (waiting.size === 0) finish({ confirmed: true, reported });
    });

    client.on("error", error =>
      finish(new SnapshotError(`Couldn't send the command to Dyson's cloud (${error.message})`))
    );
    client.on("close", () => finish({ confirmed: waiting.size === 0, reported }));
  });
}

/** Change the purifier's settings: a cloud session, then one STATE-SET. */
export async function controlPurifier(
  changes: PurifierChanges,
  options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch; connect?: ConnectFn; timeoutMs?: number } = {}
): Promise<CommandResult> {
  const data = stateSetData(changes);
  if (!Object.keys(data).length) throw new SnapshotError("No change to send");
  const { device, topicRoot, auth } = await cloudSession(options);
  return sendStateSet({
    auth,
    serial: device.serial,
    topicRoot,
    data,
    connect: options.connect,
    timeoutMs: options.timeoutMs,
  });
}
