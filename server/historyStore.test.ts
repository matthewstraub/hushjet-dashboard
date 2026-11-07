import { drizzle } from "drizzle-orm/mysql2";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HistorySlot } from "./dyson/history";
import { SERIAL } from "./dyson/testData";
import {
  saveHistory,
  storedSlots,
  toHistoryRows,
  upsertSlots,
} from "./historyStore";

const SLOT: HistorySlot = {
  slotStart: new Date("2026-11-05T02:00:00Z"),
  pm25: 4.9,
  pm10: 4.9,
  aqi: 5,
  fanSpeed: 2,
  runSeconds: 60,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("toHistoryRows", () => {
  it("adds the serial and keeps whole seconds of run time", () => {
    expect(
      toHistoryRows(SERIAL, [SLOT, { ...SLOT, runSeconds: 777.6, pm10: null }])
    ).toEqual([
      { serial: SERIAL, ...SLOT },
      { serial: SERIAL, ...SLOT, pm10: null, runSeconds: 778 },
    ]);
  });
});

describe("upsertSlots", () => {
  it("updates a stored slot without erasing values Dyson left out", () => {
    // A database that never connects, to check the SQL itself.
    const { sql, params } = upsertSlots(
      drizzle.mock(),
      toHistoryRows(SERIAL, [SLOT])
    ).toSQL();
    expect(sql).toMatch(
      /^insert into `history_slots` .* on duplicate key update /
    );
    for (const column of ["pm25", "pm10", "aqi", "fan_speed", "run_seconds"]) {
      expect(sql).toContain(
        `\`${column}\` = coalesce(values(\`${column}\`), \`${column}\`)`
      );
    }
    expect(params).toContain(SERIAL);
  });
});

describe("without a database", () => {
  it("doesn't save and has no slots", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(await saveHistory(SERIAL, [SLOT])).toBeNull();
    expect(await storedSlots(new Date(0))).toBeNull();
  });
});
