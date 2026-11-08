import { drizzle } from "drizzle-orm/mysql2";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutdoorAir } from "./dyson/outdoor";
import { SERIAL } from "./dyson/testData";
import { latestOutdoor, saveOutdoor, storedOutdoor, toOutdoorRow, upsertOutdoor } from "./outdoorStore";

const AIR: OutdoorAir = {
  measuredAt: new Date("2026-11-08T03:00:00Z"),
  aqi: 49,
  aqiName: "Good",
  pm25: 7,
  pm10: 13,
  no2: 21,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("toOutdoorRow and upsertOutdoor", () => {
  it("adds the serial and keeps whole AQI numbers", () => {
    expect(toOutdoorRow(SERIAL, { ...AIR, aqi: 48.6 })).toEqual({ serial: SERIAL, ...AIR, aqi: 49 });
  });

  it("updates a stored hour without erasing values Dyson left out", () => {
    const { sql } = upsertOutdoor(drizzle.mock(), toOutdoorRow(SERIAL, AIR)).toSQL();
    expect(sql).toMatch(/^insert into `outdoor_readings` .* on duplicate key update /);
    for (const column of ["aqi", "aqi_name", "pm25", "pm10", "no2"]) {
      expect(sql).toContain(`\`${column}\` = coalesce(values(\`${column}\`), \`${column}\`)`);
    }
  });
});

describe("without a database", () => {
  it("doesn't save and has nothing stored", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(await saveOutdoor(SERIAL, AIR)).toBe(false);
    expect(await storedOutdoor(new Date(0))).toBeNull();
    expect(await latestOutdoor()).toBeNull();
  });
});
