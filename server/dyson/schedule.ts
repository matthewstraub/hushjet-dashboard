/**
 * The purifier's schedule as the MyDyson app set it, from Dyson's unified
 * scheduler. Seen from a real HJ10: {"enabled": true, "events": [{"groupId":
 * 2, "weeklyRepeat": true, "days": [0, ..., 6], "enabled": true, "startTime":
 * "10:05:00", "settings": {"fnsp": "AUTO", "auto": "ON", "nmod": "OFF",
 * "fdir": "OFF", "oson": "OFF"}}, ...]}. Events come in pairs per group: a
 * period's start, then its end, whose days shift by one when the period runs
 * past midnight. Days count from 0, taken to be Sunday as in JavaScript.
 */

import { DysonAppApi, type JsonObject } from "./appApi";
import { loadDysonConfig } from "./config";
import { chooseDevice, deviceFromManifest } from "./devices";
import { isFields } from "./messages";

export interface ScheduleSettings {
  /** "auto", a speed from 1 to 10, or null if the event doesn't set the fan. */
  fan: "auto" | number | null;
  nightMode: boolean | null;
  power: boolean | null;
}

export interface SchedulePeriod {
  /** 0 is Sunday. */
  days: number[];
  /** "22:05", the purifier's local time. */
  start: string;
  /** When the period ends, or null for a single event. */
  end: string | null;
  enabled: boolean;
  /** Repeats every week. */
  repeats: boolean;
  settings: ScheduleSettings;
}

export interface Schedule {
  /** Whether scheduling is on at all. */
  enabled: boolean;
  periods: SchedulePeriod[];
}

const onOff = (value: unknown) => {
  const text = String(value ?? "").toUpperCase();
  return text === "ON" ? true : text === "OFF" ? false : null;
};

/** "22:05:00" -> "22:05". */
function clock(value: unknown): string | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ""));
  return match ? `${match[1]!.padStart(2, "0")}:${match[2]}` : null;
}

function settingsOf(raw: unknown): ScheduleSettings {
  const settings = isFields(raw) ? raw : {};
  const fnsp = String(settings.fnsp ?? "").toUpperCase();
  const speed = /^\d+$/.test(fnsp) ? Number.parseInt(fnsp, 10) : null;
  return {
    fan: fnsp === "AUTO" || onOff(settings.auto) === true ? "auto" : speed,
    nightMode: onOff(settings.nmod),
    power: onOff(settings.fpwr),
  };
}

/** Periods in the order they start in the day. */
export function parseSchedule(data: JsonObject): Schedule {
  const events = (Array.isArray(data.events) ? data.events : []).filter(isFields);
  // Group events, keeping their order: each group's events pair up as start and end.
  const groups = new Map<string, JsonObject[]>();
  events.forEach((event, index) => {
    const key = event.groupId === undefined ? `single-${index}` : String(event.groupId);
    const group = groups.get(key);
    if (group) group.push(event);
    else groups.set(key, [event]);
  });

  const periods: SchedulePeriod[] = [];
  groups.forEach(group => {
    for (let i = 0; i < group.length; i += 2) {
      const first = group[i]!;
      const start = clock(first.startTime);
      if (!start) continue;
      const second = group[i + 1];
      periods.push({
        days: (Array.isArray(first.days) ? first.days : []).filter((day): day is number => typeof day === "number"),
        start,
        end: second ? clock(second.startTime) : null,
        enabled: first.enabled !== false,
        repeats: first.weeklyRepeat !== false,
        settings: settingsOf(first.settings),
      });
    }
  });
  periods.sort((a, b) => a.start.localeCompare(b.start));
  return { enabled: data.enabled === true, periods };
}

/** The schedule from Dyson's cloud. HTTPS only. */
export async function readSchedule(options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}): Promise<Schedule> {
  const config = loadDysonConfig(options.env);
  const api = new DysonAppApi({
    token: config.token,
    baseUrl: config.baseUrl,
    userAgent: config.userAgent,
    fetch: options.fetch,
  });
  const device = chooseDevice((await api.manifest()).map(deviceFromManifest), config.serial);
  const data = await api.schedule(device.serial, device.productType ?? "");
  return data ? parseSchedule(data) : { enabled: false, periods: [] };
}
