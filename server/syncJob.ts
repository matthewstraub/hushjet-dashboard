/** What `pnpm sync` does, apart from the script, so it can be tested. */

import {
  readHistory,
  type HistoryResult,
  type HistorySlot,
} from "./dyson/history";
import { readPurifier, type LiveReading } from "./dyson/live";
import type { OutdoorAir } from "./dyson/outdoor";
import type { Reading } from "./dyson/messages";
import { saveHistory } from "./historyStore";
import { saveOutdoor } from "./outdoorStore";
import { saveReading } from "./readingsStore";
import { summary } from "./readingSummary";

export interface SyncOptions {
  /**
   * For the scheduled workflow. A public repo's Actions logs are public, so
   * the reading stays out of the output; and with nowhere to store it, the run
   * fails instead of passing quietly.
   */
  ci?: boolean;
  env?: NodeJS.ProcessEnv;
  read?: () => Promise<LiveReading>;
  save?: (reading: Reading) => Promise<boolean>;
  readHistory?: () => Promise<HistoryResult>;
  saveHistory?: (
    serial: string,
    slots: HistorySlot[]
  ) => Promise<number | null>;
  saveOutdoor?: (serial: string, air: OutdoorAir) => Promise<boolean>;
  log?: (line: string) => void;
  warn?: (line: string) => void;
}

const NO_DATABASE_CI = "Couldn't open the database at DATABASE_URL";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Two independent steps, so one failing doesn't cost the other: copy Dyson's
 * 15-minute history for the week, then take a snapshot for what the history
 * lacks (filter life, the fan's mode). Throws at the end if either failed.
 */
export async function runSync(options: SyncOptions = {}): Promise<void> {
  const {
    ci = false,
    env = process.env,
    read = () => readPurifier(),
    save = reading => saveReading(reading, "sync"),
    readHistory: readSlots = () => readHistory(),
    saveHistory: saveSlots = saveHistory,
    saveOutdoor: saveAir = saveOutdoor,
    log = console.log,
    warn = console.warn,
  } = options;

  // Checked first, so a misconfigured run doesn't reach Dyson at all.
  if (ci && !env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL isn't set, so there's nowhere to store readings. Add it as a repository secret."
    );
  }

  const stored: string[] = [];
  const failures: string[] = [];

  try {
    const { device, slots, outdoor, outdoorError } = await readSlots();
    const count = await saveSlots(device.serial, slots);
    const what = `${slots.length} history ${slots.length === 1 ? "slot" : "slots"}`;
    if (count !== null) {
      stored.push(what);
      if (!ci) log(`Saved ${what} from Dyson's cloud${spanText(slots)}.`);
    } else if (ci) {
      failures.push(`${NO_DATABASE_CI}, so the history wasn't stored.`);
    } else {
      log(
        `Dyson has ${what} for this week${spanText(slots)}; DATABASE_URL isn't set, so they weren't saved.`
      );
    }
    // Outdoor air comes with the history. It's extra, so a gap is a note, not a failure.
    if (outdoor) {
      if (!ci) log(`Outdoor air for ${outdoor.measuredAt.toISOString()}: ${outdoorText(outdoor)}.`);
      if (count !== null && (await saveAir(device.serial, outdoor))) stored.push("outdoor air");
    } else if (outdoorError) {
      warn(`note: no outdoor air from Dyson (${outdoorError}).`);
    }
  } catch (error) {
    failures.push(`The history wasn't copied: ${messageOf(error)}`);
  }

  try {
    const { device, reading } = await read();
    if (!ci) log(summary(device, reading));
    if (reading.monitoring === false) {
      warn(
        "note: continuous monitoring is off, so PM is only measured while the fan runs. " +
          "Turn it on in the MyDyson app."
      );
    }
    if (await save(reading)) {
      stored.push(`a reading taken at ${reading.takenAt}`);
      if (!ci) log("Saved the reading to the database.");
    } else if (ci) {
      failures.push(`${NO_DATABASE_CI}, so the reading wasn't stored.`);
    } else {
      log("DATABASE_URL isn't set, so the reading wasn't saved.");
    }
  } catch (error) {
    failures.push(`The reading failed: ${messageOf(error)}`);
  }

  if (ci && stored.length) log(`Stored ${listText(stored)}.`);
  if (failures.length) throw new Error(failures.join(" "));
}

/** "a", "a and b", "a, b and c". */
function listText(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** "AQI 49 (Good), PM2.5 7, PM10 13, NO2 21", for the local output only. */
function outdoorText(air: OutdoorAir): string {
  const value = (number: number | null) => (number === null ? "–" : String(number));
  const band = air.aqiName ? ` (${air.aqiName})` : "";
  return `AQI ${value(air.aqi)}${band}, PM2.5 ${value(air.pm25)}, PM10 ${value(air.pm10)}, NO2 ${value(air.no2)}`;
}

/** ", 2026-11-05T02:00:00.000Z to …", for the local output only. */
function spanText(slots: HistorySlot[]): string {
  const first = slots[0];
  const last = slots.at(-1);
  if (!first || !last) return "";
  return `, ${first.slotStart.toISOString()} to ${last.slotStart.toISOString()}`;
}
