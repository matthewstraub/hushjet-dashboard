/**
 * Notes: what was going on at home, typed in on the Notes tab so the charts
 * can be read against it. Cooking, cleaning, open windows, and the heat or air
 * conditioning all change the air. A note has a start, an optional end, and
 * optional details. The form and the server check notes with the same rules.
 */

export const NOTE_CATEGORIES = ["cooking", "cleaning", "windows", "heating", "cooling", "other"] as const;
export type NoteCategory = (typeof NOTE_CATEGORIES)[number];

/** The longest details, in characters. */
export const NOTE_DETAILS_MAX = 1000;
/** The longest a note can last, about the longest chart range. */
export const NOTE_MAX_DAYS = 31;
/** How far ahead of the checker's clock a start can be, for a phone whose clock runs fast. */
export const NOTE_CLOCK_SLACK_MS = 10 * 60_000;
/** The earliest start, so a mistyped year like 0026 can't be saved. */
export const NOTE_EARLIEST = new Date("2000-01-01T00:00:00Z");

const DAY_MS = 24 * 60 * 60_000;

export interface NoteInput {
  category: NoteCategory;
  startsAt: Date;
  /** When it ended, or null for a moment, like the heat coming on for the season. */
  endsAt: Date | null;
  /** Empty when there are none. */
  details: string;
}

export interface Note extends NoteInput {
  id: number;
}

export function isNoteCategory(value: unknown): value is NoteCategory {
  return typeof value === "string" && (NOTE_CATEGORIES as readonly string[]).includes(value);
}

function isTime(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** What's wrong with a note, or null if nothing is. */
export function noteProblem(note: NoteInput, now: Date = new Date()): string | null {
  if (!isNoteCategory(note.category)) return "Pick what happened";
  if (!isTime(note.startsAt)) return "Enter when it started";
  if (note.startsAt < NOTE_EARLIEST) return "Check the year it started";
  if (note.startsAt.getTime() > now.getTime() + NOTE_CLOCK_SLACK_MS) {
    return "The start can't be in the future";
  }
  if (note.endsAt !== null) {
    if (!isTime(note.endsAt)) return "Enter when it ended, or leave it empty";
    const lasted = note.endsAt.getTime() - note.startsAt.getTime();
    if (lasted <= 0) return "The end has to be after the start";
    if (lasted > NOTE_MAX_DAYS * DAY_MS) return `A note can last ${NOTE_MAX_DAYS} days at most`;
  }
  const details = note.details.trim();
  if (details.length > NOTE_DETAILS_MAX) {
    return `Keep the details to ${NOTE_DETAILS_MAX.toLocaleString("en-US")} characters`;
  }
  if (note.category === "other" && details.length === 0) return "Say what happened";
  return null;
}
