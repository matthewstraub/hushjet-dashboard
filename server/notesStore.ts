/** Storing notes and reading them back for the Notes tab and the charts. */

import { and, asc, desc, eq, gte, lt, or } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { isNoteCategory, NOTE_MAX_DAYS, type Note, type NoteInput } from "@shared/notes";
import { notes, type NewNoteRow } from "../drizzle/schema";
import { getDb } from "./db";

const DAY_MS = 24 * 60 * 60_000;

const COLUMNS = {
  id: notes.id,
  category: notes.category,
  startsAt: notes.startsAt,
  endsAt: notes.endsAt,
  details: notes.details,
};

type Selected = { id: number; category: string; startsAt: Date; endsAt: Date | null; details: string };

function toNote(row: Selected): Note {
  // A category this version doesn't know still shows, as Other.
  return { ...row, category: isNoteCategory(row.category) ? row.category : "other" };
}

/** The columns a note sets, with the details trimmed. */
export function toNoteRow(note: NoteInput): NewNoteRow {
  return {
    category: note.category,
    startsAt: note.startsAt,
    endsAt: note.endsAt,
    details: note.details.trim(),
  };
}

/** Where to continue the newest-first list: the last note already shown. */
export interface NoteCursor {
  startsAt: Date;
  id: number;
}

/**
 * Notes that started, or were still going, at `since` or later, oldest
 * first. A note lasts 31 days at most, so only starts after that far back
 * can reach it, which keeps the search on the index.
 */
export function notesSinceQuery(db: MySql2Database, since: Date, limit: number) {
  return db
    .select(COLUMNS)
    .from(notes)
    .where(
      and(
        gte(notes.startsAt, new Date(since.getTime() - NOTE_MAX_DAYS * DAY_MS)),
        or(gte(notes.startsAt, since), gte(notes.endsAt, since))
      )
    )
    .orderBy(asc(notes.startsAt), asc(notes.id))
    .limit(limit);
}

/** Notes overlapping `since` to now, oldest first. Null when no database is configured. */
export async function notesSince(since: Date, limit = 2_000): Promise<Note[] | null> {
  const db = await getDb();
  if (!db) return null;
  return (await notesSinceQuery(db, since, limit)).map(toNote);
}

/** Notes older than the cursor, newest first. */
export function notesBeforeQuery(db: MySql2Database, cursor: NoteCursor | null, limit: number) {
  return db
    .select(COLUMNS)
    .from(notes)
    .where(
      cursor
        ? or(
            lt(notes.startsAt, cursor.startsAt),
            and(eq(notes.startsAt, cursor.startsAt), lt(notes.id, cursor.id))
          )
        : undefined
    )
    .orderBy(desc(notes.startsAt), desc(notes.id))
    .limit(limit);
}

/**
 * A page of notes, newest first, and where the next page starts (null after
 * the oldest). Null when no database is configured.
 */
export async function notesPage(
  cursor: NoteCursor | null,
  limit: number
): Promise<{ notes: Note[]; next: NoteCursor | null } | null> {
  const db = await getDb();
  if (!db) return null;
  // One extra row says whether there's another page.
  const rows = (await notesBeforeQuery(db, cursor, limit + 1)).map(toNote);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    notes: page,
    next: rows.length > limit && last ? { startsAt: last.startsAt, id: last.id } : null,
  };
}

/** Save a new note. Returns its id, or null when no database is configured. */
export async function addNote(note: NoteInput): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.insert(notes).values(toNoteRow(note)).$returningId();
  return row!.id;
}

/** Change a note. Returns whether it exists, or null when no database is configured. */
export async function updateNote(id: number, note: NoteInput): Promise<boolean | null> {
  const db = await getDb();
  if (!db) return null;
  // mysql2 counts matched rows, so saving a note unchanged still counts.
  const [result] = await db.update(notes).set(toNoteRow(note)).where(eq(notes.id, id));
  return result.affectedRows > 0;
}

/** Delete a note. Returns whether it existed, or null when no database is configured. */
export async function deleteNote(id: number): Promise<boolean | null> {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.delete(notes).where(eq(notes.id, id));
  return result.affectedRows > 0;
}
