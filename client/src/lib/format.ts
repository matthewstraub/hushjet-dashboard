/** Display helpers for readings. */

export type Range = "24h" | "7d" | "30d";

type Maybe<T> = T | null | undefined;

/** A PM value, or the sensor's word (off, init, fail) for why there isn't one. */
export function pmText(value: Maybe<number>, status: Maybe<string>): string {
  if (value !== null && value !== undefined) return String(value);
  return status ? status.toLowerCase() : "–";
}

export function percentText(value: Maybe<number>): string {
  return value === null || value === undefined ? "–" : `${value}%`;
}

export function onOffText(value: Maybe<boolean>): string {
  if (value === null || value === undefined) return "–";
  return value ? "On" : "Off";
}

export function fanText(reading: {
  power: Maybe<boolean>;
  autoMode: Maybe<boolean>;
  fanSpeed: Maybe<number>;
}): string {
  if (reading.power === null || reading.power === undefined) return "–";
  if (!reading.power) return "Off";
  if (reading.autoMode) return "Auto";
  return reading.fanSpeed === null || reading.fanSpeed === undefined
    ? "On"
    : `Speed ${reading.fanSpeed}`;
}

export function clockTime(value: string | number | Date): string {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** X-axis ticks: hours across a day, dates across longer ranges. */
export function axisTime(ms: number, range: Range): string {
  const date = new Date(ms);
  return range === "24h"
    ? date.toLocaleTimeString([], { hour: "numeric" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function fullTime(ms: number): string {
  return new Date(ms).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
