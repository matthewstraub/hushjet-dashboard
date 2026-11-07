/** What `pnpm sync` does, apart from the script, so it can be tested. */

import {
  readHistory,
  type HistoryResult,
  type HistorySlot,
} from "./dyson/history";
import { readPurifier, type LiveReading } from "./dyson/live";
import type { Reading } from "./dyson/messages";
import { saveHistory } from "./historyStore";
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
    const { device, slots } = await readSlots();
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

  if (ci && stored.length) log(`Stored ${stored.join(" and ")}.`);
  if (failures.length) throw new Error(failures.join(" "));
}

/** ", 2026-11-05T02:00:00.000Z to …", for the local output only. */
function spanText(slots: HistorySlot[]): string {
  const first = slots[0];
  const last = slots.at(-1);
  if (!first || !last) return "";
  return `, ${first.slotStart.toISOString()} to ${last.slotStart.toISOString()}`;
}
