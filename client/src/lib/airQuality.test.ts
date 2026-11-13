import { describe, expect, it } from "vitest";
import { airQuality, bandFor, bandNamed, bandRangeText, BANDS, scaleScore } from "./airQuality";

const label = (pollutant: "pm25" | "pm10", value: number | null) => bandFor(pollutant, value)?.label ?? null;

describe("bandFor", () => {
  it("puts a PM2.5 reading on a limit in the lower band", () => {
    expect([0, 35, 35.4, 53, 53.1, 70, 70.5, 150, 151, 250, 250.1, 999].map(v => label("pm25", v))).toEqual([
      "Good",
      "Good",
      "Fair",
      "Fair",
      "Poor",
      "Poor",
      "Very poor",
      "Very poor",
      "Extremely poor",
      "Extremely poor",
      "Severe",
      "Severe",
    ]);
  });

  it("uses PM10's own limits", () => {
    expect([50, 51, 75, 76, 100, 101, 350, 351, 420, 421].map(v => label("pm10", v))).toEqual([
      "Good",
      "Fair",
      "Fair",
      "Poor",
      "Poor",
      "Very poor",
      "Very poor",
      "Extremely poor",
      "Extremely poor",
      "Severe",
    ]);
  });

  it("has no band without a reading", () => {
    expect(bandFor("pm25", null)).toBeNull();
    expect(bandFor("pm10", undefined)).toBeNull();
  });
});

describe("scaleScore", () => {
  it("moves through each band in proportion", () => {
    expect(scaleScore("pm25", 0)).toBe(0);
    expect(scaleScore("pm25", 17.5)).toBe(0.5);
    expect(scaleScore("pm25", 35)).toBe(1);
    expect(scaleScore("pm25", 44)).toBe(1.5);
    expect(scaleScore("pm10", 100)).toBe(3);
  });

  it("draws Severe as reaching twice its lower limit, and stops at the end", () => {
    expect(scaleScore("pm25", 375)).toBe(5.5);
    expect(scaleScore("pm25", 5_000)).toBe(6);
  });
});

describe("airQuality", () => {
  it("is the pollutant further along its scale", () => {
    // 40 is Fair for PM2.5 but Good for PM10.
    expect(airQuality(40, 40)).toMatchObject({ band: { label: "Fair" }, dominant: "pm25" });
    expect(airQuality(10, 90)).toMatchObject({ band: { label: "Poor" }, dominant: "pm10" });
  });

  it("names PM2.5 in clean air, and uses whichever reading there is", () => {
    expect(airQuality(3, 3)).toMatchObject({ band: { label: "Good" }, dominant: "pm25" });
    expect(airQuality(null, 3)).toMatchObject({ band: { label: "Good" }, dominant: "pm10" });
    expect(airQuality(null, undefined)).toBeNull();
  });
});

describe("bandNamed and bandRangeText", () => {
  it("finds a band by its name, in any case", () => {
    expect(bandNamed("Good")?.id).toBe("good");
    expect(bandNamed("Very Poor")?.id).toBe("very-poor");
    expect(bandNamed("Moderate")).toBeNull();
    expect(bandNamed(null)).toBeNull();
  });

  it("describes each band's range", () => {
    expect(bandRangeText("pm25", BANDS[0]!)).toBe("up to 35");
    expect(bandRangeText("pm10", BANDS[3]!)).toBe("up to 350");
    expect(bandRangeText("pm25", BANDS[5]!)).toBe("over 250");
  });
});
