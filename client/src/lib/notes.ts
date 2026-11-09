/** Showing notes: their labels and icons, their times, and where they go on the charts. */

import type { Note, NoteCategory } from "@shared/notes";
import { AirVent, Blinds, CookingPot, Heater, Sparkles, StickyNote, type LucideIcon } from "lucide-react";
import { clockTime, fullTime } from "./format";

export interface NoteKind {
  label: string;
  icon: LucideIcon;
  /** An example for the details box. */
  example: string;
}

/** In the order the form offers them. */
export const NOTE_KINDS: Record<NoteCategory, NoteKind> = {
  cooking: { label: "Cooking", icon: CookingPot, example: "Stir-fry on the stove, or the oven at 425°F" },
  cleaning: { label: "Cleaning", icon: Sparkles, example: "Vacuumed and dusted" },
  windows: { label: "Windows open", icon: Blinds, example: "Bedroom and living room" },
  heating: { label: "Heating", icon: Heater, example: "The heat came on for the season" },
  cooling: { label: "Air conditioning", icon: AirVent, example: "The AC ran all afternoon" },
  other: { label: "Other", icon: StickyNote, example: "Lit candles" },
};

type Timed = Pick<Note, "startsAt" | "endsAt">;

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

/** A local date and time to the minute, as a datetime-local input takes it: "2026-11-08T18:30". */
export function toLocalInput(date: Date): string {
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

const LOCAL_INPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** A datetime-local input's value as a time, or null when it's empty or unfinished. */
export function fromLocalInput(value: string): Date | null {
  if (!LOCAL_INPUT.test(value)) return null;
  // With no offset, this is read as local time.
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The local day a time falls on, as YYYY-MM-DD. */
export function localDay(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * "6:30 PM", "6:30 PM – 7:15 PM", or "11:00 PM – Nov 9, 1:00 AM" when it
 * ends on a later day. With `withDate`, the start has its date too.
 */
export function noteTimeText(note: Timed, { withDate = false } = {}): string {
  const start = withDate ? fullTime(note.startsAt.getTime()) : clockTime(note.startsAt);
  if (!note.endsAt) return start;
  const sameDay = localDay(note.endsAt) === localDay(note.startsAt);
  return `${start} – ${sameDay ? clockTime(note.endsAt) : fullTime(note.endsAt.getTime())}`;
}

/** "Cooking, Nov 8, 6:30 PM – 7:15 PM". */
export function noteSummary(note: Timed & Pick<Note, "category">): string {
  return `${NOTE_KINDS[note.category].label}, ${noteTimeText(note, { withDate: true })}`;
}

/** Notes grouped by the local day each started on, keeping the order they came in. */
export function notesByDay<T extends Timed>(notes: T[]): { day: string; notes: T[] }[] {
  const days: { day: string; notes: T[] }[] = [];
  for (const note of notes) {
    const day = localDay(note.startsAt);
    const last = days.at(-1);
    if (last?.day === day) last.notes.push(note);
    else days.push({ day, notes: [note] });
  }
  return days;
}

/**
 * A chart's span, stretched right to take in notes up to now. The history
 * ends where its newest 15-minute slot starts, so a note made a few minutes
 * ago would otherwise fall past the end of the chart until the next slot.
 */
export function spanWithNotes(span: [number, number], notes: Timed[], now: number): [number, number] {
  let end = span[1];
  for (const note of notes) {
    end = Math.max(end, Math.min(note.endsAt?.getTime() ?? note.startsAt.getTime(), now));
  }
  return [span[0], end];
}

/** Whether any of a note falls between two times. */
export function noteOverlaps(note: Timed, [from, to]: [number, number]): boolean {
  const start = note.startsAt.getTime();
  return (note.endsAt?.getTime() ?? start) >= from && start <= to;
}

/** The notes going on at a time, or starting within `tolerance` milliseconds of it. */
export function notesAt<T extends Timed>(notes: T[], t: number, tolerance: number): T[] {
  return notes.filter(note => {
    const start = note.startsAt.getTime();
    if (Math.abs(start - t) <= tolerance) return true;
    return note.endsAt !== null && start <= t && t <= note.endsAt.getTime();
  });
}

export interface LaneChip<T> {
  /** Where the chip goes, in pixels. */
  x: number;
  notes: T[];
}

/**
 * Chips along the top of a chart, one at each note's start, or at the left
 * edge for a note that started earlier. Notes closer together than `gap`
 * pixels share one chip, so chips never overlap.
 */
export function laneChips<T extends Timed>(
  notes: T[],
  span: [number, number],
  x: (t: number) => number,
  gap: number
): LaneChip<T>[] {
  const placed = notes
    .filter(note => noteOverlaps(note, span))
    .map(note => ({ note, at: x(Math.max(note.startsAt.getTime(), span[0])) }))
    .sort((a, b) => a.at - b.at);
  const chips: LaneChip<T>[] = [];
  for (const { note, at } of placed) {
    const last = chips.at(-1);
    if (last && at - last.x < gap) last.notes.push(note);
    else chips.push({ x: at, notes: [note] });
  }
  return chips;
}
