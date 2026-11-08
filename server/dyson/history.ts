/**
 * Dyson's cloud keeps a 15-minute history of the purifier for the last seven
 * days: PM2.5, PM10, an air quality index, the fan's average speed and how
 * long it ran. It's what the MyDyson app charts. The window starts at
 * midnight six days ago in the account's time zone (start_time) and moves
 * forward a day at a time, so `pnpm sync` stores every slot as it goes,
 * updating ones it already has, since the current slot fills in as its 15
 * minutes pass.
 *
 * Seen from a real HJ10: {"start_time": "2026-11-01T05:00:00Z", "resolution":
 * "PT15M", "p25m": [...672], "p10m": [...], "aqlm": [...], "fnsp": [...],
 * "usage": [...]}, with null for slots without data.
 */

import { DysonApiError, DysonAppApi, type JsonObject } from "./appApi";
import { loadDysonConfig } from "./config";
import { chooseDevice, deviceFromManifest, type Device } from "./devices";
import { parseOutdoor, type OutdoorAir } from "./outdoor";

export interface HistorySlot {
  /** When the slot began. */
  slotStart: Date;
  /** Average PM2.5 over the slot, µg/m³. */
  pm25: number | null;
  pm10: number | null;
  /** Dyson's air quality index for the slot. */
  aqi: number | null;
  /** Average fan speed, 1 to 10. Present in auto mode too. */
  fanSpeed: number | null;
  /** Seconds the fan ran during the slot; 900 is all 15 minutes. */
  runSeconds: number | null;
}

/** Each slot field, and the key Dyson sends its series under. */
const SERIES = {
  pm25: "p25m",
  pm10: "p10m",
  aqi: "aqlm",
  fanSpeed: "fnsp",
  runSeconds: "usage",
} as const;

type SeriesField = keyof typeof SERIES;

/** "PT15M" -> 15. A plain number is taken as minutes, as libdyson-rest assumes. */
export function resolutionMinutes(value: unknown): number {
  if (typeof value === "number" && value > 0) return value;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(String(value ?? ""));
  const minutes = match
    ? Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)
    : 0;
  if (!minutes)
    throw new DysonApiError(
      `The history has an unexpected resolution: ${String(value)}`
    );
  return minutes;
}

/** The slots that have any data, oldest first. */
export function parseHistory(data: JsonObject): HistorySlot[] {
  const start = Date.parse(String(data.start_time ?? ""));
  if (Number.isNaN(start))
    throw new DysonApiError("The history response has no start_time");
  const step = resolutionMinutes(data.resolution) * 60_000;
  const columns = (Object.keys(SERIES) as SeriesField[]).map(field => {
    const values = data[SERIES[field]];
    return [field, Array.isArray(values) ? values : []] as const;
  });
  const length = Math.max(0, ...columns.map(([, values]) => values.length));

  const slots: HistorySlot[] = [];
  for (let i = 0; i < length; i++) {
    const slot: HistorySlot = {
      slotStart: new Date(start + i * step),
      pm25: null,
      pm10: null,
      aqi: null,
      fanSpeed: null,
      runSeconds: null,
    };
    let filled = false;
    for (const [field, values] of columns) {
      const value = values[i];
      if (typeof value === "number" && Number.isFinite(value)) {
        slot[field] = value;
        filled = true;
      }
    }
    if (filled) slots.push(slot);
  }
  return slots;
}

export interface HistoryResult {
  device: Device;
  slots: HistorySlot[];
  /** Dyson's outdoor figures for the area, fetched in the same session. */
  outdoor?: OutdoorAir | null;
  /** Why there are no outdoor figures, when fetching them failed. */
  outdoorError?: string;
}

/**
 * The last seven days of history from Dyson's cloud, and the latest outdoor air
 * figures with it. Only HTTPS calls, no MQTT. The outdoor figures are extra,
 * so failing to get them doesn't fail the history.
 */
export async function readHistory(
  options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}
): Promise<HistoryResult> {
  const config = loadDysonConfig(options.env);
  const api = new DysonAppApi({
    token: config.token,
    baseUrl: config.baseUrl,
    userAgent: config.userAgent,
    fetch: options.fetch,
  });
  const device = chooseDevice(
    (await api.manifest()).map(deviceFromManifest),
    config.serial
  );
  const data = await api.environmentHistory(device.serial);
  const slots = data ? parseHistory(data) : [];
  try {
    const air = await api.outdoorAir(device.serial);
    return { device, slots, outdoor: air ? parseOutdoor(air) : null };
  } catch (error) {
    return { device, slots, outdoor: null, outdoorError: error instanceof Error ? error.message : String(error) };
  }
}
