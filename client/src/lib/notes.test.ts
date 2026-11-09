import { describe, expect, it } from "vitest";
import type { Note } from "@shared/notes";
import {
  fromLocalInput,
  laneChips,
  localDay,
  notesAt,
  notesByDay,
  noteOverlaps,
  noteSummary,
  noteTimeText,
  spanWithNotes,
  toLocalInput,
} from "./notes";

/** A note at a local time, so the tests pass in any time zone. */
function note(id: number, start: string, end: string | null = null, category: Note["category"] = "cooking"): Note {
  return {
    id,
    category,
    startsAt: new Date(start),
    endsAt: end === null ? null : new Date(end),
    details: "",
  };
}

describe("toLocalInput and fromLocalInput", () => {
  it("round-trip a local time to the minute", () => {
    const date = new Date(2026, 10, 8, 18, 30, 45);
    expect(toLocalInput(date)).toBe("2026-11-08T18:30");
    expect(fromLocalInput("2026-11-08T18:30")).toEqual(new Date(2026, 10, 8, 18, 30));
    expect(fromLocalInput("2026-11-08T18:30:15")).toEqual(new Date(2026, 10, 8, 18, 30, 15));
  });

  it("pads early years, and reads nothing from an empty or unfinished value", () => {
    const early = new Date(2026, 10, 8, 9, 5);
    early.setFullYear(26);
    expect(toLocalInput(early)).toBe("0026-11-08T09:05");
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("2026-11-08")).toBeNull();
    expect(fromLocalInput("2026-13-45T99:99")).toBeNull();
  });
});

describe("noteTimeText and noteSummary", () => {
  it("shows a moment, a span, and a span into the next day", () => {
    expect(noteTimeText(note(1, "2026-11-08T18:30"))).toBe("6:30 PM");
    expect(noteTimeText(note(1, "2026-11-08T18:30", "2026-11-08T19:15"))).toBe("6:30 PM – 7:15 PM");
    expect(noteTimeText(note(1, "2026-11-08T23:00", "2026-11-09T01:00"))).toBe("11:00 PM – Nov 9, 1:00 AM");
  });

  it("can add the date, for charts that cover several days", () => {
    expect(noteTimeText(note(1, "2026-11-08T18:30", "2026-11-08T19:15"), { withDate: true })).toBe(
      "Nov 8, 6:30 PM – 7:15 PM"
    );
    expect(noteSummary(note(1, "2026-11-08T14:00", null, "windows"))).toBe("Windows open, Nov 8, 2:00 PM");
  });
});

describe("notesByDay", () => {
  it("groups the newest-first list by local day", () => {
    const notes = [note(3, "2026-11-08T18:30"), note(2, "2026-11-08T08:00"), note(1, "2026-11-07T21:00")];
    expect(notesByDay(notes)).toEqual([
      { day: "2026-11-08", notes: [notes[0], notes[1]] },
      { day: "2026-11-07", notes: [notes[2]] },
    ]);
    expect(localDay(new Date(2026, 0, 2, 0, 0))).toBe("2026-01-02");
  });
});

describe("noteOverlaps and notesAt", () => {
  const span: [number, number] = [new Date("2026-11-08T00:00").getTime(), new Date("2026-11-08T23:59").getTime()];
  const windows = note(1, "2026-11-07T20:00", "2026-11-08T09:00", "windows");
  const cooking = note(2, "2026-11-08T18:30");

  it("keeps notes that are on the chart anywhere", () => {
    expect(noteOverlaps(windows, span)).toBe(true);
    expect(noteOverlaps(cooking, span)).toBe(true);
    expect(noteOverlaps(note(3, "2026-11-07T12:00", "2026-11-07T13:00"), span)).toBe(false);
    expect(noteOverlaps(note(4, "2026-11-09T08:00"), span)).toBe(false);
  });

  it("finds a moment near the time, and a span the time is in", () => {
    const at = (time: string) => notesAt([windows, cooking], new Date(time).getTime(), 10 * 60_000);
    expect(at("2026-11-08T18:30")).toEqual([cooking]);
    expect(at("2026-11-08T18:39")).toEqual([cooking]);
    expect(at("2026-11-08T18:45")).toEqual([]);
    expect(at("2026-11-08T06:00")).toEqual([windows]);
  });
});

describe("spanWithNotes", () => {
  const from = new Date("2026-11-08T09:30").getTime();
  const newestSlot = new Date("2026-11-09T09:15").getTime();
  const now = new Date("2026-11-09T09:31").getTime();

  it("reaches a note made after the newest slot started", () => {
    expect(spanWithNotes([from, newestSlot], [note(1, "2026-11-09T09:27")], now)).toEqual([
      from,
      new Date("2026-11-09T09:27").getTime(),
    ]);
  });

  it("stops at now for a note that hasn't ended, and leaves the span alone otherwise", () => {
    expect(spanWithNotes([from, newestSlot], [note(1, "2026-11-09T08:00", "2026-11-09T18:00")], now)).toEqual([
      from,
      now,
    ]);
    expect(spanWithNotes([from, newestSlot], [note(1, "2026-11-09T08:00")], now)).toEqual([from, newestSlot]);
    expect(spanWithNotes([from, newestSlot], [], now)).toEqual([from, newestSlot]);
  });
});

describe("laneChips", () => {
  // 1 pixel per minute from midnight.
  const from = new Date("2026-11-08T00:00").getTime();
  const span: [number, number] = [from, from + 24 * 60 * 60_000];
  const x = (t: number) => (t - from) / 60_000;

  it("puts a chip at each note's start, and at the left edge for one that started earlier", () => {
    const chips = laneChips(
      [note(2, "2026-11-08T18:30"), note(1, "2026-11-07T20:00", "2026-11-08T09:00")],
      span,
      x,
      20
    );
    expect(chips.map(chip => [chip.x, chip.notes.map(n => n.id)])).toEqual([
      [0, [1]],
      [1110, [2]],
    ]);
  });

  it("shares a chip between notes closer than the gap, and leaves out notes off the chart", () => {
    const chips = laneChips(
      [
        note(1, "2026-11-08T18:00"),
        note(2, "2026-11-08T18:10"),
        note(3, "2026-11-08T18:19"),
        note(4, "2026-11-08T18:20"),
        note(5, "2026-11-09T08:00"),
      ],
      span,
      x,
      20
    );
    expect(chips.map(chip => [chip.x, chip.notes.map(n => n.id)])).toEqual([
      [1080, [1, 2, 3]],
      [1100, [4]],
    ]);
  });
});
