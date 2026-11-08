/**
 * One row per local day from Dyson's 15-minute slots: average and peak
 * PM2.5, time above the WHO guideline, how long the day's worst spike took
 * to clear, and what the fan did. Days follow the viewer's time zone.
 */

import type { HistorySlot } from "./dyson/history";

/** µg/m³: the WHO's 2021 guideline for 24-hour average PM2.5. */
export const WHO_PM25_24H = 15;
/** µg/m³: a 15-minute average at or above this counts as a spike. */
export const SPIKE_PM25 = 35;

const SLOT_MINUTES = 15;

export interface DaySummary {
  /** The local date, YYYY-MM-DD. */
  date: string;
  /** True for the day that's still going. */
  today: boolean;
  /** Slots with PM2.5 data; a full day has 96. */
  slots: number;
  avgPm25: number | null;
  /** Whether the day's average, before rounding, was over WHO_PM25_24H. */
  aboveGuideline: boolean;
  peakPm25: number | null;
  /** When the slot with the peak began. */
  peakAt: Date | null;
  /** Minutes in slots averaging over WHO_PM25_24H; null with no PM2.5 data. */
  minutesAbove: number | null;
  /**
   * When the day's peak was a spike: minutes from it until a slot averaged
   * under WHO_PM25_24H again, or null if none has yet.
   */
  spike: { clearedMinutes: number | null } | null;
  /** Average fan speed while the fan ran, weighted by how long it ran in each slot. */
  avgFanSpeed: number | null;
  /** Hours the fan ran. */
  fanHours: number | null;
}

/**
 * A function giving "2026-11-05" for when a date falls in `timeZone`. Make
 * one and reuse it: building the formatter is the slow part.
 */
export function localDateIn(timeZone: string): (date: Date) => string {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return date => {
    const parts = format.formatToParts(date);
    const part = (type: string) => parts.find(p => p.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
}

/** "2026-11-05" for when `date` falls in `timeZone`. */
export function localDate(date: Date, timeZone: string): string {
  return localDateIn(timeZone)(date);
}

/** Whether `name` is a time zone this runtime knows, like "America/New_York". */
export function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * How much of a slot has happened by `now`: all 15 minutes, except for the
 * newest slot, which Dyson fills in as it goes.
 */
function elapsedMs(slot: HistorySlot, now: Date): number {
  return Math.min(SLOT_MINUTES * 60_000, Math.max(0, now.getTime() - slot.slotStart.getTime()));
}

/** Mean PM2.5 over the time the slots cover, so a slot one minute old counts for a minute. */
function pmMeanOver(slots: HistorySlot[], now: Date): number | null {
  if (!slots.length) return null;
  let total = 0;
  let weight = 0;
  for (const slot of slots) {
    const ms = elapsedMs(slot, now);
    total += slot.pm25! * ms;
    weight += ms;
  }
  // Only slots stamped after `now` would leave no weight; count them equally then.
  return weight ? total / weight : slots.reduce((sum, slot) => sum + slot.pm25!, 0) / slots.length;
}

/** The date `n` calendar days before a YYYY-MM-DD date, whatever the clocks do. */
export function daysBefore(date: string, n: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! - n)).toISOString().slice(0, 10);
}

/**
 * The last `days` local days that have slots, newest first. `slots` must be
 * oldest first; a spike is followed into later slots, past midnight if need be.
 */
export function summarizeDays(slots: HistorySlot[], timeZone: string, days: number, now: Date): DaySummary[] {
  const dateOf = localDateIn(timeZone);
  const today = dateOf(now);
  // Counted in calendar days, so a clock change doesn't add or drop one.
  const oldest = daysBefore(today, days - 1);
  const byDate = new Map<string, number[]>();
  slots.forEach((slot, index) => {
    const date = dateOf(slot.slotStart);
    if (date < oldest || date > today) return;
    const indexes = byDate.get(date);
    if (indexes) indexes.push(index);
    else byDate.set(date, [index]);
  });

  const summaries: DaySummary[] = [];
  byDate.forEach((indexes, date) => {
    const day = indexes.map(index => slots[index]!);
    const pm = day.filter(slot => slot.pm25 !== null);
    const peakIndex = indexes.reduce<number | null>((best, index) => {
      const value = slots[index]!.pm25;
      if (value === null) return best;
      return best === null || value > slots[best]!.pm25! ? index : best;
    }, null);
    const peak = peakIndex === null ? null : slots[peakIndex]!;
    const ran = day.filter(slot => slot.runSeconds !== null && slot.runSeconds > 0 && slot.fanSpeed !== null);
    const ranSeconds = ran.reduce((sum, slot) => sum + slot.runSeconds!, 0);
    const pmMean = pmMeanOver(pm, now);
    const runSeconds = day.filter(slot => slot.runSeconds !== null).map(slot => slot.runSeconds!);

    summaries.push({
      date,
      today: date === today,
      slots: pm.length,
      avgPm25: pmMean === null ? null : round1(pmMean),
      // From the unrounded mean, so 15.04 counts though it shows as 15.
      aboveGuideline: pmMean !== null && pmMean > WHO_PM25_24H,
      peakPm25: peak?.pm25 ?? null,
      peakAt: peak?.slotStart ?? null,
      minutesAbove: pm.length ? minutesOver(pm, now) : null,
      spike: peakIndex !== null && peak!.pm25! >= SPIKE_PM25 ? { clearedMinutes: clearedAfter(slots, peakIndex) } : null,
      avgFanSpeed: ranSeconds
        ? round1(ran.reduce((sum, slot) => sum + slot.fanSpeed! * slot.runSeconds!, 0) / ranSeconds)
        : null,
      fanHours: runSeconds.length ? round1(runSeconds.reduce((sum, seconds) => sum + seconds, 0) / 3600) : null,
    });
  });
  return summaries.reverse();
}

/**
 * Minutes in slots averaging over the guideline. The newest slot is still
 * filling in, so it counts only up to now.
 */
function minutesOver(slots: HistorySlot[], now: Date): number {
  const ms = slots
    .filter(slot => slot.pm25! > WHO_PM25_24H)
    .reduce((sum, slot) => sum + elapsedMs(slot, now), 0);
  return Math.round(ms / 60_000);
}

/** Minutes from slots[peakIndex] to the next slot averaging under the guideline. */
function clearedAfter(slots: HistorySlot[], peakIndex: number): number | null {
  const start = slots[peakIndex]!.slotStart.getTime();
  for (const slot of slots.slice(peakIndex + 1)) {
    if (slot.pm25 !== null && slot.pm25 < WHO_PM25_24H) {
      return Math.round((slot.slotStart.getTime() - start) / 60_000);
    }
  }
  return null;
}
