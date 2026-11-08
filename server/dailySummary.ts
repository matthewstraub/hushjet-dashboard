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
const DAY_MS = 24 * 60 * 60_000;

export interface DaySummary {
  /** The local date, YYYY-MM-DD. */
  date: string;
  /** True for the day that's still going. */
  today: boolean;
  /** Slots with PM2.5 data; a full day has 96. */
  slots: number;
  avgPm25: number | null;
  peakPm25: number | null;
  /** When the slot with the peak began. */
  peakAt: Date | null;
  /** Minutes in slots averaging over WHO_PM25_24H. */
  minutesAbove: number;
  /**
   * When the day's peak was a spike: minutes from it until a slot averaged
   * under WHO_PM25_24H again, or null if none has yet.
   */
  spike: { clearedMinutes: number | null } | null;
  /** Average fan speed over the slots the fan ran in. */
  avgFanSpeed: number | null;
  /** Hours the fan ran. */
  fanHours: number | null;
}

/** "2026-11-05" for when `date` falls in `timeZone`. */
export function localDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
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

function average(values: number[]): number | null {
  return values.length ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

/**
 * The last `days` local days that have slots, newest first. `slots` must be
 * oldest first; a spike is followed into later slots, past midnight if need be.
 */
export function summarizeDays(slots: HistorySlot[], timeZone: string, days: number, now: Date): DaySummary[] {
  const today = localDate(now, timeZone);
  const oldest = localDate(new Date(now.getTime() - (days - 1) * DAY_MS), timeZone);
  const byDate = new Map<string, number[]>();
  slots.forEach((slot, index) => {
    const date = localDate(slot.slotStart, timeZone);
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
    const ran = day.filter(slot => slot.runSeconds !== null && slot.runSeconds > 0);
    const runSeconds = day.filter(slot => slot.runSeconds !== null).map(slot => slot.runSeconds!);

    summaries.push({
      date,
      today: date === today,
      slots: pm.length,
      avgPm25: average(pm.map(slot => slot.pm25!)),
      peakPm25: peak?.pm25 ?? null,
      peakAt: peak?.slotStart ?? null,
      minutesAbove: pm.filter(slot => slot.pm25! > WHO_PM25_24H).length * SLOT_MINUTES,
      spike: peakIndex !== null && peak!.pm25! >= SPIKE_PM25 ? { clearedMinutes: clearedAfter(slots, peakIndex) } : null,
      avgFanSpeed: average(ran.filter(slot => slot.fanSpeed !== null).map(slot => slot.fanSpeed!)),
      fanHours: runSeconds.length ? round1(runSeconds.reduce((sum, seconds) => sum + seconds, 0) / 3600) : null,
    });
  });
  return summaries.reverse();
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
