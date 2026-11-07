import { describe, expect, it, vi } from "vitest";
import type { LiveReading } from "./dyson/live";
import { Snapshot } from "./dyson/messages";
import { capturePayloads, MANIFEST_ENTRY, REAL_CAPTURE, SERIAL } from "./dyson/testData";
import { deviceFromManifest } from "./dyson/devices";
import { runSync } from "./syncJob";

function realLive(overrides: Partial<LiveReading["reading"]> = {}): LiveReading {
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
  return {
    lines,
    warnings,
    read,
    save,
    options: { read, save, log: (line: string) => lines.push(line), warn: (line: string) => warnings.push(line) },
  };
}

describe("runSync", () => {
  it("prints the reading locally, and says when there's no database", async () => {
    const { lines, options } = setup({ stored: false });
    await runSync({ ...options, env: {} });
    expect(lines).toEqual([
      "Bedroom: PM2.5 3, PM10 2, HEPA 100%, carbon 100%, fan on at speed 4",
      "DATABASE_URL isn't set, so the reading wasn't saved.",
    ]);
  });

  it("keeps the reading and the device out of the CI log", async () => {
    const { lines, save, options } = setup();
    await runSync({ ...options, ci: true, env: { DATABASE_URL: "mysql://example" } });
    expect(save).toHaveBeenCalledOnce();
    expect(lines).toEqual(["Stored a reading taken at 2026-11-07T00:10:25.075Z."]);
    expect(lines.join("\n")).not.toMatch(/Bedroom|PM2\.5|HEPA|speed/);
  });

  it("fails in CI without a database, before reaching Dyson", async () => {
    const { read, options } = setup();
    await expect(runSync({ ...options, ci: true, env: {} })).rejects.toThrow("DATABASE_URL isn't set");
    expect(read).not.toHaveBeenCalled();
  });

  it("fails in CI when the reading couldn't be stored", async () => {
    const { options } = setup({ stored: false });
    await expect(runSync({ ...options, ci: true, env: { DATABASE_URL: "mysql://example" } })).rejects.toThrow(
      "wasn't stored"
    );
  });

  it("warns when continuous monitoring is off", async () => {
    const { warnings, options } = setup({ live: realLive({ monitoring: false }) });
    await runSync({ ...options, ci: true, env: { DATABASE_URL: "mysql://example" } });
    expect(warnings).toEqual([expect.stringContaining("continuous monitoring is off")]);
  });
});
