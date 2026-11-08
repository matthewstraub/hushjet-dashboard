/**
 * One reading through Dyson's cloud: connect, ask for state, sensor data and
 * the fault report, wait for them, disconnect. `pnpm sync` and the
 * dashboard's live reading use this; the CLI's `listen --cloud` keeps a
 * connection open instead.
 */

import mqtt, { type IClientOptions } from "mqtt";
import { cloudClientOptions, cloudUrl, type CloudAuth } from "./cloud";
import {
  CURRENT_FAULTS,
  CURRENT_STATE,
  REQUEST_FAULTS,
  REQUEST_SENSOR_DATA,
  REQUEST_STATE,
  SENSOR_DATA,
  Snapshot,
  type Reading,
} from "./messages";

/** The part of an MQTT.js client this uses, so tests can stand in for the broker. */
export interface SnapshotClient {
  on(event: "connect", listener: () => void): unknown;
  on(event: "message", listener: (topic: string, payload: Buffer) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  subscribe(topics: string[], callback: (error: Error | null) => void): unknown;
  publish(topic: string, message: string): unknown;
  end(force?: boolean): unknown;
}

export type ConnectFn = (url: string, options: IClientOptions) => SnapshotClient;

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotError";
  }
}

export interface SnapshotOptions {
  auth: CloudAuth;
  serial: string;
  topicRoot: string;
  connect?: ConnectFn;
  timeoutMs?: number;
  /**
   * When to ask again for state or sensor data that hasn't come. The HJ10
   * now and then ignores a request.
   */
  retryAfterMs?: number;
  /**
   * How long the fault report gets once state and sensor data are in: half
   * a second, then it's asked for again and gets this long. Without it, the
   * reading has no faults rather than failing.
   */
  faultsWaitMs?: number;
  now?: () => Date;
}

/** How long the fault report gets after state and sensor data before it's asked for again. */
const FAULTS_GRACE_MS = 500;

export const defaultConnect: ConnectFn = (url, options) =>
  mqtt.connect(url, options) as unknown as SnapshotClient;

/** The time format the purifier expects in commands: no milliseconds. */
export function commandTime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function takeSnapshot(options: SnapshotOptions): Promise<Reading> {
  const {
    auth,
    serial,
    topicRoot,
    connect = defaultConnect,
    timeoutMs = 20_000,
    retryAfterMs = 4_000,
    faultsWaitMs = 2_000,
  } = options;
  const now = options.now ?? (() => new Date());
  const statusTopic = `${topicRoot}/${serial}/status/current`;
  const faultsTopic = `${topicRoot}/${serial}/status/faults`;
  const commandTopic = `${topicRoot}/${serial}/command`;
  const snapshot = new Snapshot();
  let gotState = false;
  let gotSensor = false;
  let gotFaults = false;

  return new Promise<Reading>((resolve, reject) => {
    const client = connect(cloudUrl(auth), cloudClientOptions(auth));
    let settled = false;
    let retryTimer: NodeJS.Timeout | undefined;
    let faultsTimer: NodeJS.Timeout | undefined;

    const request = (...messages: string[]) => {
      for (const msg of messages) {
        client.publish(commandTopic, JSON.stringify({ msg, time: commandTime(now()) }));
      }
    };

    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(retryTimer);
      clearTimeout(faultsTimer);
      client.end(true);
      if (error) reject(error);
      else resolve(snapshot.reading(serial, now().toISOString()));
    };

    const timer = setTimeout(() => {
      // A fault report still on its way doesn't fail a reading that has the rest.
      if (gotState && gotSensor) {
        finish(null);
        return;
      }
      const missing = [!gotState && "state", !gotSensor && "sensor data"].filter(Boolean);
      finish(
        new SnapshotError(
          `The purifier didn't send its ${missing.join(" or ")} within ${timeoutMs / 1000}s. ` +
            "It may be unplugged or offline."
        )
      );
    }, timeoutMs);

    client.on("connect", () => {
      client.subscribe([statusTopic, faultsTopic], error => {
        if (error) {
          finish(new SnapshotError(`Dyson's cloud refused the subscription (${error.message})`));
          return;
        }
        // The HJ10 also answers a state request with sensor data; asking for
        // both covers firmware that doesn't.
        request(REQUEST_STATE, REQUEST_SENSOR_DATA, REQUEST_FAULTS);
        retryTimer = setTimeout(() => {
          if (!gotState) request(REQUEST_STATE);
          if (!gotSensor) request(REQUEST_SENSOR_DATA);
        }, retryAfterMs);
      });
    });

    client.on("message", (_topic, payload) => {
      let data: unknown;
      try {
        data = JSON.parse(payload.toString("utf8"));
      } catch {
        return;
      }
      const kind = snapshot.apply(data);
      // A STATE-CHANGE alone isn't a full state, so only CURRENT-STATE counts.
      if (kind === CURRENT_STATE) gotState = true;
      if (kind === SENSOR_DATA) gotSensor = true;
      if (kind === CURRENT_FAULTS) gotFaults = true;
      if (!gotState || !gotSensor) return;
      if (gotFaults) {
        finish(null);
        return;
      }
      // Faults usually follow within half a second; if not, ask once more.
      faultsTimer ??= setTimeout(() => {
        request(REQUEST_FAULTS);
        faultsTimer = setTimeout(() => finish(null), faultsWaitMs);
      }, FAULTS_GRACE_MS);
    });

    client.on("error", error => finish(cloudError(error)));
    client.on("close", () => {
      finish(new SnapshotError("Dyson's cloud closed the connection before the purifier answered"));
    });
  });
}

function cloudError(error: Error): SnapshotError {
  // ws reports a refused websocket upgrade as "Unexpected server response: 401".
  if (/Unexpected server response: (401|403)/.test(error.message)) {
    return new SnapshotError(
      "Dyson's cloud turned down the IoT credentials. Try again; if it keeps failing, " +
        "log in again with `hushjet login --force` in cli/."
    );
  }
  return new SnapshotError(`Couldn't connect to Dyson's cloud (${error.message})`);
}
