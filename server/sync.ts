/**
 * `pnpm sync`: take one reading through Dyson's cloud and store it. The
 * scheduled GitHub workflow will run this every 15 minutes. Locally it uses
 * the token from `hushjet login` in cli/, and prints the reading even when no
 * database is configured.
 */

import "dotenv/config";
import { closeDb } from "./db";
import { readPurifier } from "./dyson/live";
import { saveReading } from "./readingsStore";
import { summary } from "./readingSummary";

async function main(): Promise<void> {
  const { device, reading } = await readPurifier();
  console.log(summary(device, reading));
  if (reading.monitoring === false) {
    console.warn(
      "note: continuous monitoring is off, so PM is only measured while the fan runs. " +
        "Turn it on in the MyDyson app."
    );
  }
  const stored = await saveReading(reading, "sync");
  console.log(stored ? "Saved to the database." : "DATABASE_URL isn't set, so the reading wasn't saved.");
}

main()
  .catch(error => {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
