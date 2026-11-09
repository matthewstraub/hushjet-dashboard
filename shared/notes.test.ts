import { describe, expect, it } from "vitest";
import { isNoteCategory, NOTE_DETAILS_MAX, noteProblem, type NoteInput } from "./notes";

const NOW = new Date("2026-11-08T23:00:00Z");
const COOKING: NoteInput = {
  category: "cooking",
  startsAt: new Date("2026-11-08T22:30:00Z"),
  endsAt: null,
  details: "",
};

describe("noteProblem", () => {
  it("accepts a moment, or a span with details", () => {
    expect(noteProblem(COOKING, NOW)).toBeNull();
    expect(
      noteProblem(
        { ...COOKING, endsAt: new Date("2026-11-08T23:15:00Z"), details: "Oven at 425°F" },
        NOW
      )
    ).toBeNull();
  });

  it("needs a known category", () => {
    expect(noteProblem({ ...COOKING, category: "smoking" as never }, NOW)).toBe("Pick what happened");
    expect(isNoteCategory("windows")).toBe(true);
    expect(isNoteCategory("Windows")).toBe(false);
  });

  it("needs a real start that isn't in the future", () => {
    expect(noteProblem({ ...COOKING, startsAt: new Date("nope") }, NOW)).toBe("Enter when it started");
    expect(noteProblem({ ...COOKING, startsAt: new Date("0026-11-08T22:30:00Z") }, NOW)).toBe(
      "Check the year it started"
    );
    // A few minutes ahead is a phone's clock running fast; an hour isn't.
    expect(noteProblem({ ...COOKING, startsAt: new Date("2026-11-08T23:05:00Z") }, NOW)).toBeNull();
    expect(noteProblem({ ...COOKING, startsAt: new Date("2026-11-09T00:00:00Z") }, NOW)).toBe(
      "The start can't be in the future"
    );
  });

  it("needs an end after the start, at most 31 days later", () => {
    expect(noteProblem({ ...COOKING, endsAt: COOKING.startsAt }, NOW)).toBe("The end has to be after the start");
    expect(noteProblem({ ...COOKING, endsAt: new Date("2026-11-08T22:00:00Z") }, NOW)).toBe(
      "The end has to be after the start"
    );
    expect(noteProblem({ ...COOKING, endsAt: new Date("nope") }, NOW)).toBe(
      "Enter when it ended, or leave it empty"
    );
    expect(noteProblem({ ...COOKING, endsAt: new Date("2026-12-10T22:30:00Z") }, NOW)).toBe(
      "A note can last 31 days at most"
    );
    // An end that hasn't come yet is fine: windows open until this evening.
    expect(noteProblem({ ...COOKING, endsAt: new Date("2026-11-09T02:00:00Z") }, NOW)).toBeNull();
  });

  it("limits the details, and needs them for Other", () => {
    expect(noteProblem({ ...COOKING, details: "x".repeat(NOTE_DETAILS_MAX) }, NOW)).toBeNull();
    expect(noteProblem({ ...COOKING, details: `  ${"x".repeat(NOTE_DETAILS_MAX)}  ` }, NOW)).toBeNull();
    expect(noteProblem({ ...COOKING, details: "x".repeat(NOTE_DETAILS_MAX + 1) }, NOW)).toBe(
      "Keep the details to 1,000 characters"
    );
    expect(noteProblem({ ...COOKING, category: "other", details: "   " }, NOW)).toBe("Say what happened");
    expect(noteProblem({ ...COOKING, category: "other", details: "Lit candles" }, NOW)).toBeNull();
  });
});
