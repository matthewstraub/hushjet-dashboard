import { describe, expect, it, vi } from "vitest";
import { deviceFromManifest } from "./dyson/devices";
import type { HistorySlot } from "./dyson/history";
import type { LiveReading } from "./dyson/live";
import { Snapshot } from "./dyson/messages";
import { SnapshotError } from "./dyson/snapshot";
import {
  capturePayloads,
  MANIFEST_ENTRY,
  REAL_CAPTURE,
  SERIAL,
} from "./dyson/testData";
import { runSync } from "./syncJob";

const CI_ENV = { DATABASE_URL: "mysql://example" };

const SLOTS: HistorySlot[] = [0, 1, 2].map(i => ({
  slotStart: new Date(Date.UTC(2026, 10, 5, 2, 15 * i)),
  pm25: 2.5,
  pm10: 2.5,
  aqi: 2.5,
  fanSpeed: 2,
  runSeconds: 900,
}));

function realLive(
  overrides: Partial<LiveReading["reading"]> = {}
): LiveReading {
  const snapshot = new Snapshot();
  for (const payload of capturePayloads(REAL_CAPTURE)) snapshot.apply(payload);
  return {
    device: deviceFromManifest(MANIFEST_ENTRY),
    reading: { ...snapshot.reading(SERIAL, "2026-11-07T00:10:25.075Z"), ...overrides },
  };
}

function setup({ stored = true, live = realLive() } = {}) {
  const lines: string[] = [];
  const warnings: string[] = [];
  const read = vi.fn(async () => live);
  const save = vi.fn(async () => stored);
  const readHistory = vi.fn(async () => ({
    device: live.device,
    slots: SLOTS,
  }));
  const saveHistory = vi.fn(async (_serial: string, slots: HistorySlot[]) =>
    stored ? slots.length : null
  );
  return {
    lines,
    warnings,
    read,
    save,
    readHistory,
    saveHistory,
    options: {
      read,
      save,
      readHistory,
      saveHistory,
      log: (line: string) => lines.push(line),
      warn: (line: string) => warnings.push(line),
    },
  };
}

describe("runSync", () => {
  it("prints the history and the reading locally, and says when there's no database", async () => {
    const { lines, options } = setup({ stored: false });
    await runSync({ ...options, env: {} });
    expect(lines).toEqual([
      "Dyson has 3 history slots for this week, 2026-11-05T02:00:00.000Z to 2026-11-05T02:30:00.000Z; " +
        "DATABASE_URL isn't set, so they weren't saved.",
      "Bedroom: PM2.5 3, PM10 2, HEPA 100%, carbon 100%, fan on at speed 4",
      "DATABASE_URL isn't set, so the reading wasn't saved.",
    ]);
  });

  it("stores the history under the purifier's serial, and the reading", async () => {
    const { lines, save, saveHistory, options } = setup();
    await runSync({ ...options, env: {} });
    expect(saveHistory).toHaveBeenCalledWith(SERIAL, SLOTS);
    expect(save).toHaveBeenCalledOnce();
    expect(lines).toEqual([
      "Saved 3 history slots from Dyson's cloud, 2026-11-05T02:00:00.000Z to 2026-11-05T02:30:00.000Z.",
      "Bedroom: PM2.5 3, PM10 2, HEPA 100%, carbon 100%, fan on at speed 4",
      "Saved the reading to the database.",
    ]);
  });

  it("keeps the reading and the device out of the CI log", async () => {
    const { lines, save, options } = setup();
    await runSync({ ...options, ci: true, env: CI_ENV });
    expect(save).toHaveBeenCalledOnce();
    expect(lines).toEqual([
      "Stored 3 history slots and a reading taken at 2026-11-07T00:10:25.075Z.",
    ]);
    expect(lines.join("\n")).not.toMatch(/Bedroom|PM2\.5|HEPA|speed|HJ1/);
  });

  it("still stores the reading when the history fails, then fails the run", async () => {
    const { lines, save, readHistory, options } = setup();
    readHistory.mockRejectedValue(
      new Error("GET /v1/messageprocessor returned 500")
    );
    await expect(
      runSync({ ...options, ci: true, env: CI_ENV })
    ).rejects.toThrow(
      "The history wasn't copied: GET /v1/messageprocessor returned 500"
    );
    expect(save).toHaveBeenCalledOnce();
    expect(lines).toEqual([
      "Stored a reading taken at 2026-11-07T00:10:25.075Z.",
    ]);
  });

  it("still stores the history when the reading fails, then fails the run", async () => {
    const { lines, read, saveHistory, options } = setup();
    read.mockRejectedValue(new SnapshotError("The purifier didn't answer"));
    await expect(
      runSync({ ...options, ci: true, env: CI_ENV })
    ).rejects.toThrow("The reading failed: The purifier didn't answer");
    expect(saveHistory).toHaveBeenCalledOnce();
    expect(lines).toEqual(["Stored 3 history slots."]);
  });

  it("fails in CI without a database, before reaching Dyson", async () => {
    const { read, readHistory, options } = setup();
    await expect(runSync({ ...options, ci: true, env: {} })).rejects.toThrow(
      "DATABASE_URL isn't set"
    );
    expect(read).not.toHaveBeenCalled();
    expect(readHistory).not.toHaveBeenCalled();
  });

  it("fails in CI when nothing could be stored", async () => {
    const { lines, options } = setup({ stored: false });
    await expect(
      runSync({ ...options, ci: true, env: CI_ENV })
    ).rejects.toThrow(
      "so the history wasn't stored. Couldn't open the database at DATABASE_URL, so the reading wasn't stored."
    );
    expect(lines).toEqual([]);
  });

  it("warns when continuous monitoring is off", async () => {
    const { warnings, options } = setup({
      live: realLive({ monitoring: false }),
    });
    await runSync({ ...options, ci: true, env: CI_ENV });
    expect(warnings).toEqual([
      expect.stringContaining("continuous monitoring is off"),
    ]);
  });
});
