import { describe, expect, it } from "vitest";
import {
  connectionItem,
  faultsItem,
  firmwareItem,
  historyItem,
  syncItem,
  wifiItem,
  type Faults,
} from "./status";

const ALL_OK: Faults = {
  checks: { "product-errors": { sen1: "OK", amf5: "OK" }, "product-warnings": { fltr: "OK" } },
  problems: [],
};
const NOW = Date.parse("2026-11-07T22:00:00Z");
const MIN = 60_000;

describe("faultsItem", () => {
  it("is good when every check is OK", () => {
    expect(faultsItem(ALL_OK)).toMatchObject({ level: "good", value: "No faults", detail: "All 3 checks report OK." });
  });

  it("names a single problem, and calls the filter warning by name", () => {
    const filter = { ...ALL_OK, problems: [{ group: "product-warnings", code: "fltr", value: "CHNG" }] };
    expect(faultsItem(filter)).toMatchObject({ level: "warning", value: "Filter warning (CHNG)" });
  });

  it("treats errors as critical and lists several problems", () => {
    const item = faultsItem({
      ...ALL_OK,
      problems: [
        { group: "product-errors", code: "sen1", value: "FAIL" },
        { group: "module-warnings", code: "nwcs", value: "WARN" },
      ],
    });
    expect(item).toMatchObject({
      level: "critical",
      value: "2 problems",
      detail: "Purifier error sen1: FAIL; Module warning nwcs: WARN",
    });
  });

  it("says when there's no report, or no reading yet", () => {
    expect(faultsItem(null)).toMatchObject({ level: "unknown", value: "No report" });
    expect(faultsItem(undefined)).toMatchObject({ level: "unknown", value: "–" });
  });
});

describe("firmwareItem", () => {
  it("flags an update and shows the version", () => {
    const device = { firmwareVersion: "0897PF.00.01.004.0007", newVersionAvailable: true };
    expect(firmwareItem(device)).toEqual({
      label: "Firmware",
      level: "warning",
      value: "Update available",
      detail: "Version 0897PF.00.01.004.0007",
    });
    expect(firmwareItem({ ...device, newVersionAvailable: false })).toMatchObject({ level: "good", value: "Up to date" });
    expect(firmwareItem(undefined)).toMatchObject({ level: "unknown" });
  });
});

describe("wifiItem", () => {
  it.each([
    [-38, "good", "Strong"],
    [-65, "good", "Good"],
    [-75, "warning", "Weak"],
    [-85, "critical", "Very weak"],
  ])("rates %i dBm as %s", (dbm, level, value) => {
    expect(wifiItem(dbm)).toMatchObject({ level, value, detail: `${dbm} dBm` });
  });
});

describe("connectionItem", () => {
  it("tells a token problem from Dyson not answering", () => {
    expect(
      connectionItem({ loading: false, error: { message: "Dyson rejected the token", code: "PRECONDITION_FAILED" } })
    ).toMatchObject({ level: "critical", value: "Needs attention", detail: "Dyson rejected the token" });
    expect(
      connectionItem({ loading: false, error: { message: "The purifier didn't answer", code: "BAD_GATEWAY" } })
    ).toMatchObject({ level: "warning", value: "No answer" });
  });

  it("is good once a reading arrives, and waits while loading", () => {
    expect(connectionItem({ loading: false, takenAt: "2026-11-07T21:58:00Z" })).toMatchObject({
      level: "good",
      value: "Connected",
    });
    expect(connectionItem({ loading: true })).toMatchObject({ level: "unknown", value: "Checking…" });
  });
});

describe("syncItem", () => {
  it("only warns after a long gap, since GitHub runs it irregularly", () => {
    expect(syncItem(new Date(NOW - 85 * MIN), true, NOW)).toMatchObject({ level: "good", value: "1 h ago" });
    expect(syncItem(new Date(NOW - 7 * 60 * MIN), true, NOW)).toMatchObject({ level: "warning", value: "7 h ago" });
    expect(syncItem(new Date(NOW - 50 * 60 * MIN), true, NOW)).toMatchObject({ level: "critical", value: "2 days ago" });
  });

  it("says when it hasn't run or there's no database", () => {
    expect(syncItem(null, true, NOW)).toMatchObject({ level: "warning", value: "Hasn't run" });
    expect(syncItem(null, false, NOW)).toMatchObject({ level: "unknown", value: "No database" });
  });
});

describe("historyItem", () => {
  it("is good within an hour of now, and shows when the newest slot ends", () => {
    const item = historyItem(new Date(NOW - 30 * MIN), true, NOW);
    expect(item.level).toBe("good");
    expect(item.value).toMatch(/^Through /);
    expect(historyItem(new Date(NOW - 2 * 60 * MIN), true, NOW).level).toBe("warning");
    expect(historyItem(new Date(NOW - 7 * 60 * MIN), true, NOW).level).toBe("critical");
    expect(historyItem(null, true, NOW)).toMatchObject({ level: "warning", value: "None yet" });
  });
});
