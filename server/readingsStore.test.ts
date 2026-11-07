import { afterEach, describe, expect, it, vi } from "vitest";
import type { Device } from "./dyson/devices";
import { Snapshot } from "./dyson/messages";
import { capturePayloads, REAL_CAPTURE, SERIAL } from "./dyson/testData";
import { latestSyncAt, saveReading, storedHistory, toRow } from "./readingsStore";
import { summary } from "./readingSummary";

function realReading() {
  const snapshot = new Snapshot();
  for (const payload of capturePayloads(REAL_CAPTURE)) snapshot.apply(payload);
  return snapshot.reading(SERIAL, "2026-11-07T00:10:25.075Z");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("toRow", () => {
  it("keeps the flat values for the charts and every field the purifier sent", () => {
    const row = toRow(realReading(), "sync");
    expect(row).toMatchObject({
      takenAt: new Date("2026-11-07T00:10:25.075Z"),
      serial: SERIAL,
      source: "sync",
      power: true,
      fanSpeed: 4,
      nightMode: true,
      hepaFilterPct: 100,
      carbonFilterPct: 100,
      pm25: 3,
      pm10: 2,
      sensorStatus: null,
    });
    expect(row.state).toMatchObject({ hflr: "0100", hflt: "EHEP" });
    expect(row.sensor).toMatchObject({ pm25: "0003", p25r: "0003" });
  });
});

describe("without a database", () => {
  it("doesn't save and has no history", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(await saveReading(realReading(), "sync")).toBe(false);
    expect(await storedHistory(new Date(0))).toBeNull();
    expect(await latestSyncAt()).toBeNull();
  });
});

describe("summary", () => {
  it("describes a reading in one line", () => {
    const device = { serial: SERIAL, name: "Bedroom" } as Device;
    expect(summary(device, realReading())).toBe(
      "Bedroom: PM2.5 3, PM10 2, HEPA 100%, carbon 100%, fan on at speed 4"
    );
    const off = { ...realReading(), power: false, pm25: null, pm10: null, sensorStatus: "OFF" };
    expect(summary(device, off)).toBe("Bedroom: PM2.5 off, PM10 off, HEPA 100%, carbon 100%, fan off");
  });
});
