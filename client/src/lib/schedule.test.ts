import { describe, expect, it } from "vitest";
import { clockText, daysText, settingsText } from "./schedule";

describe("schedule words", () => {
  it("shows 24-hour times as 12-hour ones", () => {
    expect(["00:00", "07:30", "10:05", "12:00", "22:05"].map(clockText)).toEqual([
      "12:00 AM",
      "7:30 AM",
      "10:05 AM",
      "12:00 PM",
      "10:05 PM",
    ]);
  });

  it("names the days, Monday first", () => {
    expect(daysText([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(daysText([1, 2, 3, 4, 5, 6, 0])).toBe("Every day");
    expect(daysText([1, 2, 3, 4, 5])).toBe("Weekdays");
    expect(daysText([6, 0])).toBe("Weekends");
    expect(daysText([5, 1, 3])).toBe("Mon, Wed, Fri");
    expect(daysText([])).toBe("No days");
  });

  it("describes what a period sets", () => {
    expect(settingsText({ fan: "auto", nightMode: true, power: null })).toBe("Auto · Night mode on");
    expect(settingsText({ fan: 4, nightMode: null, power: null })).toBe("Speed 4");
    expect(settingsText({ fan: null, nightMode: null, power: false })).toBe("Power off");
    expect(settingsText({ fan: null, nightMode: null, power: true })).toBe("Power on");
    expect(settingsText({ fan: null, nightMode: null, power: null })).toBe("No changes");
  });
});
