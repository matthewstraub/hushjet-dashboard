import { drizzle } from "drizzle-orm/mysql2";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteInput } from "@shared/notes";
import {
  addNote,
  deleteNote,
  notesBeforeQuery,
  notesPage,
  notesSince,
  notesSinceQuery,
  toNoteRow,
  updateNote,
} from "./notesStore";

const NOTE: NoteInput = {
  category: "cooking",
  startsAt: new Date("2026-11-08T22:30:00Z"),
  endsAt: new Date("2026-11-08T23:15:00Z"),
  details: "  Oven at 425°F \n",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("toNoteRow", () => {
  it("saves the details trimmed", () => {
    expect(toNoteRow(NOTE)).toEqual({ ...NOTE, details: "Oven at 425°F" });
  });
});

describe("notesSinceQuery", () => {
  it("finds notes that start or are still going in the range, using the index", () => {
    const since = new Date("2026-11-08T00:00:00Z");
    // A database that never connects, to check the SQL itself.
    const { sql, params } = notesSinceQuery(drizzle.mock(), since, 2_000).toSQL();
    expect(sql).toBe(
      "select `id`, `category`, `starts_at`, `ends_at`, `details` from `notes` " +
        "where (`notes`.`starts_at` >= ? and (`notes`.`starts_at` >= ? or `notes`.`ends_at` >= ?)) " +
        "order by `notes`.`starts_at` asc, `notes`.`id` asc limit ?"
    );
    // Starts up to 31 days back can still be going.
    expect(params).toEqual([
      "2026-10-08 00:00:00.000",
      "2026-11-08 00:00:00.000",
      "2026-11-08 00:00:00.000",
      2_000,
    ]);
  });
});

describe("notesBeforeQuery", () => {
  it("lists the newest first", () => {
    const { sql, params } = notesBeforeQuery(drizzle.mock(), null, 51).toSQL();
    expect(sql).toBe(
      "select `id`, `category`, `starts_at`, `ends_at`, `details` from `notes` " +
        "order by `notes`.`starts_at` desc, `notes`.`id` desc limit ?"
    );
    expect(params).toEqual([51]);
  });

  it("continues after the last note shown, even when two start at the same time", () => {
    const cursor = { startsAt: new Date("2026-11-08T22:30:00Z"), id: 7 };
    const { sql, params } = notesBeforeQuery(drizzle.mock(), cursor, 51).toSQL();
    expect(sql).toContain(
      "where (`notes`.`starts_at` < ? or (`notes`.`starts_at` = ? and `notes`.`id` < ?))"
    );
    expect(params).toEqual(["2026-11-08 22:30:00.000", "2026-11-08 22:30:00.000", 7, 51]);
  });
});

describe("without a database", () => {
  it("doesn't save and has nothing stored", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(await notesSince(new Date(0))).toBeNull();
    expect(await notesPage(null, 50)).toBeNull();
    expect(await addNote(NOTE)).toBeNull();
    expect(await updateNote(1, NOTE)).toBeNull();
    expect(await deleteNote(1)).toBeNull();
  });
});
