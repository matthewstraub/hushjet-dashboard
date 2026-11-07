/** What the status card says about each part of the system, and how worried to be. */

import { agoText, clockTime, fullTime } from "./format";

export type Level = "good" | "warning" | "critical" | "unknown";

export interface StatusItem {
  label: string;
  level: Level;
  value: string;
  detail?: string;
}

/** The parts of a fault report this needs; see server/dyson/messages.ts. */
export interface Faults {
  checks: Partial<Record<string, Record<string, string>>>;
  problems: { group: string; code: string; value: string }[];
}

const GROUP_NAMES: Record<string, string> = {
  "product-errors": "Purifier error",
  "product-warnings": "Purifier warning",
  "module-errors": "Module error",
  "module-warnings": "Module warning",
};

const HOUR_MS = 60 * 60_000;

function describeProblem({ group, code, value }: Faults["problems"][number]): string {
  if (code === "fltr") return `Filter warning (${value})`;
  return `${GROUP_NAMES[group] ?? group} ${code}: ${value}`;
}

/** The purifier's own checks. Undefined until there's a reading. */
export function faultsItem(faults: Faults | null | undefined): StatusItem {
  const label = "Purifier checks";
  if (faults === undefined) return { label, level: "unknown", value: "–" };
  if (faults === null) {
    return {
      label,
      level: "unknown",
      value: "No report",
      detail: "The purifier didn't send its fault report with this reading.",
    };
  }
  const total = Object.values(faults.checks).reduce(
    (sum, group) => sum + Object.keys(group ?? {}).length,
    0
  );
  if (faults.problems.length === 0) {
    return { label, level: "good", value: "No faults", detail: `All ${total} checks report OK.` };
  }
  const errors = faults.problems.some(problem => problem.group.endsWith("-errors"));
  return {
    label,
    level: errors ? "critical" : "warning",
    value:
      faults.problems.length === 1
        ? describeProblem(faults.problems[0]!)
        : `${faults.problems.length} problems`,
    detail:
      faults.problems.length === 1 ? "Check the MyDyson app." : faults.problems.map(describeProblem).join("; "),
  };
}

export function firmwareItem(
  device: { firmwareVersion: string | null; newVersionAvailable: boolean | null } | undefined
): StatusItem {
  const label = "Firmware";
  const detail = device?.firmwareVersion ? `Version ${device.firmwareVersion}` : undefined;
  if (device?.newVersionAvailable === true) {
    return { label, level: "warning", value: "Update available", detail };
  }
  if (device?.newVersionAvailable === false) return { label, level: "good", value: "Up to date", detail };
  return { label, level: "unknown", value: "–", detail };
}

/** The purifier's Wi-Fi signal, in dBm. */
export function wifiItem(dbm: number | null | undefined): StatusItem {
  const label = "Wi-Fi signal";
  if (dbm === null || dbm === undefined) return { label, level: "unknown", value: "–" };
  const detail = `${dbm} dBm`;
  if (dbm >= -60) return { label, level: "good", value: "Strong", detail };
  if (dbm >= -70) return { label, level: "good", value: "Good", detail };
  if (dbm >= -80) return { label, level: "warning", value: "Weak", detail };
  return { label, level: "critical", value: "Very weak", detail };
}

/** Reaching the purifier through Dyson's cloud, as the live reading went. */
export function connectionItem(live: {
  loading: boolean;
  takenAt?: string;
  error?: { message: string; code?: string } | null;
}): StatusItem {
  const label = "Dyson cloud";
  if (live.error) {
    // PRECONDITION_FAILED is the token or the setup; BAD_GATEWAY is Dyson or the purifier.
    if (live.error.code === "BAD_GATEWAY") {
      return { label, level: "warning", value: "No answer", detail: live.error.message };
    }
    return { label, level: "critical", value: "Needs attention", detail: live.error.message };
  }
  if (live.takenAt) {
    return { label, level: "good", value: "Connected", detail: `Read the purifier at ${clockTime(live.takenAt)}.` };
  }
  return { label, level: "unknown", value: live.loading ? "Checking…" : "–" };
}

/**
 * When `pnpm sync` last stored a reading. GitHub runs it irregularly, so
 * only a long gap is a warning.
 */
export function syncItem(lastSyncAt: Date | null | undefined, databaseConfigured: boolean, now: number): StatusItem {
  const label = "Scheduled sync";
  if (!databaseConfigured) return { label, level: "unknown", value: "No database" };
  if (lastSyncAt === undefined) return { label, level: "unknown", value: "–" };
  if (lastSyncAt === null) {
    return { label, level: "warning", value: "Hasn't run", detail: "It runs from GitHub Actions; see the README." };
  }
  const age = now - lastSyncAt.getTime();
  return {
    label,
    level: age < 6 * HOUR_MS ? "good" : age < 24 * HOUR_MS ? "warning" : "critical",
    value: agoText(lastSyncAt.getTime(), now),
    detail: `Last ran ${fullTime(lastSyncAt.getTime())}. GitHub runs it irregularly.`,
  };
}

/** The newest of Dyson's 15-minute slots in the database. */
export function historyItem(newestSlot: Date | null | undefined, databaseConfigured: boolean, now: number): StatusItem {
  const label = "Saved history";
  if (!databaseConfigured) return { label, level: "unknown", value: "No database" };
  if (newestSlot === undefined) return { label, level: "unknown", value: "–" };
  if (newestSlot === null) {
    return { label, level: "warning", value: "None yet", detail: "It's copied as this page loads." };
  }
  const start = newestSlot.getTime();
  const age = now - start;
  return {
    label,
    // This page copies the newest slots as it loads, so more than an hour
    // behind means copying is failing.
    level: age < HOUR_MS ? "good" : age < 6 * HOUR_MS ? "warning" : "critical",
    value: `Through ${clockTime(start + 15 * 60_000)}`,
    detail: `The newest 15-minute average starts ${fullTime(start)}.`,
  };
}
