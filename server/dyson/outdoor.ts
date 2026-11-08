/**
 * Dyson's outdoor air figures for the purifier's area, as the MyDyson app
 * shows them: one set per hour. Seen from a real account:
 * {"DateTime": "2026-11-08T03:00:00Z", "AqiValue": 49, "AqiName": "Good",
 * "Pm25Value": 7, "Pm10Value": 13, "No2Value": 21, "LocationName": ...,
 * plus weather and pollen fields that were null}. The place name is never
 * read, so it isn't stored or shown. Dyson doesn't say which unit NO2 is in.
 */

import type { JsonObject } from "./appApi";

export interface OutdoorAir {
  /** The hour the figures are for. */
  measuredAt: Date;
  aqi: number | null;
  /** The AQI's band, like "Good". */
  aqiName: string | null;
  /** µg/m³. */
  pm25: number | null;
  pm10: number | null;
  no2: number | null;
}

const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 64) : null);

/** The figures, or null without a time or any of them. */
export function parseOutdoor(data: JsonObject): OutdoorAir | null {
  const measuredAt = Date.parse(String(data.DateTime ?? ""));
  if (Number.isNaN(measuredAt)) return null;
  const air: OutdoorAir = {
    measuredAt: new Date(measuredAt),
    aqi: number(data.AqiValue),
    aqiName: text(data.AqiName),
    pm25: number(data.Pm25Value),
    pm10: number(data.Pm10Value),
    no2: number(data.No2Value),
  };
  return [air.aqi, air.pm25, air.pm10, air.no2].some(value => value !== null) ? air : null;
}
