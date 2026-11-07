/** One line describing a reading, for `pnpm sync` and its logs. */

import type { Device } from "./dyson/devices";
import type { Reading } from "./dyson/messages";

function pm(value: number | null, status: string | null): string {
  if (value !== null) return String(value);
  return status ? status.toLowerCase() : "?";
}

function percent(value: number | null): string {
  return value === null ? "?" : `${value}%`;
}

function fan(reading: Reading): string {
  if (reading.power === null) return "fan ?";
  if (!reading.power) return "fan off";
  if (reading.autoMode) return "fan on (auto)";
  return reading.fanSpeed === null ? "fan on" : `fan on at speed ${reading.fanSpeed}`;
}

export function summary(device: Device, reading: Reading): string {
  return (
    `${device.name ?? device.serial}: PM2.5 ${pm(reading.pm25, reading.sensorStatus)}, ` +
    `PM10 ${pm(reading.pm10, reading.sensorStatus)}, HEPA ${percent(reading.hepaFilterPct)}, ` +
    `carbon ${percent(reading.carbonFilterPct)}, ${fan(reading)}`
  );
}
