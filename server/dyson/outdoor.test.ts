import { describe, expect, it } from "vitest";
import { parseOutdoor } from "./outdoor";

// Shaped like a real response; the place name is made up.
const RESPONSE = {
  DateTime: "2026-11-08T03:00:00Z",
  AqiState: 0,
  AqiValue: 49,
  ColorValue: null,
  Pm25Value: 7,
  Pm10Value: 13,
  No2Value: 21,
  WeatherState: 2,
  Humidity: null,
  Temperature: null,
  LocationName: "1 Example Street",
  ColorIndex: "1",
  AqiName: "Good",
  AqiDescription: "Air quality is considered satisfactory, and air pollution poses little or no risk.",
  Icon: null,
  Measure: "AQI",
  PollenState: 0,
  DominantPollen: null,
  Pollens: null,
};

describe("parseOutdoor", () => {
  it("keeps the hour and the figures, and never the place", () => {
    const air = parseOutdoor(RESPONSE);
    expect(air).toEqual({
      measuredAt: new Date("2026-11-08T03:00:00Z"),
      aqi: 49,
      aqiName: "Good",
      pm25: 7,
      pm10: 13,
      no2: 21,
    });
    expect(JSON.stringify(air)).not.toContain("Example");
  });

  it("returns null without a time or without any figures", () => {
    expect(parseOutdoor({ ...RESPONSE, DateTime: null })).toBeNull();
    expect(parseOutdoor({ DateTime: "2026-11-08T03:00:00Z", AqiValue: null, Pm25Value: null })).toBeNull();
  });

  it("keeps the figures it has", () => {
    expect(parseOutdoor({ DateTime: "2026-11-08T03:00:00Z", Pm25Value: 4.5, AqiName: "" })).toMatchObject({
      pm25: 4.5,
      aqi: null,
      aqiName: null,
    });
  });
});
