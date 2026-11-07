/**
 * `pnpm sync`: take one reading through Dyson's cloud and store it. Locally it
 * uses the token from `hushjet login` in cli/, and prints the reading even
 * when no database is configured. The scheduled workflow runs `pnpm sync --ci`
 * every 15 minutes; see server/syncJob.ts for what --ci changes.
 */

import "dotenv/config";
import { closeDb } from "./db";
import { runSync } from "./syncJob";

runSync({ ci: process.argv.includes("--ci") })
  .catch(error => {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
