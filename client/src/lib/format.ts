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

export function numberText(value: Maybe<number>): string {
  return value === null || value === undefined ? "–" : String(value);
}

export function minutesText(value: Maybe<number>): string {
  return value === null || value === undefined ? "–" : `${value} min`;
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

const HOUR_MS = 3_600_000;
/** Spacings between x-axis ticks, in hours: on the hour, then whole days. */
const TICK_STEPS = [1, 2, 3, 6, 12, 24, 48, 72, 96, 168];

export interface TimeAxis {
  ticks: number[];
  format: (ms: number) => string;
}

/**
 * X-axis ticks on round local times, at most maxTicks of them: on the hour,
 * labelled "3 PM" (or with the date at midnight), or at midnight, labelled
 * with the date.
 */
export function timeAxis(min: number, max: number, maxTicks = 8): TimeAxis {
  const spanHours = Math.max(0, max - min) / HOUR_MS;
  const step = TICK_STEPS.find(hours => spanHours / hours <= maxTicks) ?? 168;
  const tick = new Date(min);
  tick.setMinutes(0, 0, 0);
  if (step < 24) {
    while (tick.getTime() < min || tick.getHours() % step !== 0)
      tick.setHours(tick.getHours() + 1);
  } else {
    tick.setHours(0);
    if (tick.getTime() < min) tick.setDate(tick.getDate() + 1);
  }
  const ticks: number[] = [];
  while (tick.getTime() <= max) {
    ticks.push(tick.getTime());
    if (step < 24) tick.setHours(tick.getHours() + step);
    else tick.setDate(tick.getDate() + step / 24);
  }
  const date = (ms: number) =>
    new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
  const hour = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: "numeric" });
  return {
    ticks,
    format: ms =>
      step < 24 && new Date(ms).getHours() !== 0 ? hour(ms) : date(ms),
  };
}

export function fullTime(ms: number): string {
  return new Date(ms).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "45 min", "2 h", "1 h 30 min". */
export function durationText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** "Today", or "Thu, Nov 5" for a YYYY-MM-DD date in the viewer's time zone. */
export function dayLabel(date: string, today: boolean): string {
  if (today) return "Today";
  // Noon, so no time zone shift can move it to another day.
  return new Date(`${date}T12:00:00`).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function agoText(ms: number, now: number): string {
  const minutes = Math.floor((now - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/** "Nov 5, 2:00 AM – 2:15 AM": the time a 15-minute slot covers. */
export function slotTime(ms: number, lengthMs = 15 * 60_000): string {
  return `${fullTime(ms)} – ${clockTime(ms + lengthMs)}`;
}
