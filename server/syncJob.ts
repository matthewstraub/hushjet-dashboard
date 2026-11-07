/** What `pnpm sync` does, apart from the script, so it can be tested. */

import { readPurifier, type LiveReading } from "./dyson/live";
import type { Reading } from "./dyson/messages";
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
  log?: (line: string) => void;
  warn?: (line: string) => void;
}

export async function runSync(options: SyncOptions = {}): Promise<void> {
  const {
    ci = false,
    env = process.env,
    read = () => readPurifier(),
    save = reading => saveReading(reading, "sync"),
    log = console.log,
    warn = console.warn,
  } = options;

  // Checked first, so a misconfigured run doesn't reach Dyson at all.
  if (ci && !env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL isn't set, so there's nowhere to store readings. Add it as a repository secret."
    );
  }

  const { device, reading } = await read();
  if (!ci) log(summary(device, reading));
  if (reading.monitoring === false) {
    warn(
      "note: continuous monitoring is off, so PM is only measured while the fan runs. " +
        "Turn it on in the MyDyson app."
    );
  }

  const stored = await save(reading);
  if (stored) {
    log(ci ? `Stored a reading taken at ${reading.takenAt}.` : "Saved to the database.");
  } else if (ci) {
    throw new Error("Couldn't open the database at DATABASE_URL, so the reading wasn't stored.");
  } else {
    log("DATABASE_URL isn't set, so the reading wasn't saved.");
  }
}
