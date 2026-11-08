import { describe, expect, it } from "vitest";
import {
  dayLabel,
  durationText,
  fanText,
  minutesText,
  numberText,
  onOffText,
  percentText,
  pmText,
  timeAxis,
} from "./format";

describe("format", () => {
  it("shows PM values, or the sensor's word when it isn't measuring", () => {
    expect([
      pmText(3, null),
      pmText(0, null),
      pmText(null, "OFF"),
      pmText(null, null),
      pmText(undefined, undefined),
    ]).toEqual(["3", "0", "off", "–", "–"]);
  });

  it("shows percentages and on/off", () => {
    expect([percentText(100), percentText(0), percentText(null)]).toEqual([
      "100%",
      "0%",
      "–",
    ]);
    expect([onOffText(true), onOffText(false), onOffText(null)]).toEqual([
      "On",
      "Off",
      "–",
    ]);
  });

  it("shows averages and minutes", () => {
    expect([numberText(2.1), numberText(0), numberText(null)]).toEqual([
      "2.1",
      "0",
      "–",
    ]);
    expect([minutesText(15), minutesText(0), minutesText(undefined)]).toEqual([
      "15 min",
      "0 min",
      "–",
    ]);
  });

  it("shows durations and day names", () => {
    expect([durationText(0), durationText(45), durationText(120), durationText(90)]).toEqual([
      "0 min",
      "45 min",
      "2 h",
      "1 h 30 min",
    ]);
    expect(dayLabel("2026-11-07", true)).toBe("Today");
    expect(dayLabel("2026-11-05", false)).toBe(
      new Date(2026, 10, 5, 12).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
    );
  });

  it("describes the fan", () => {
    expect(fanText({ power: true, autoMode: false, fanSpeed: 4 })).toBe("Speed 4");
    expect(fanText({ power: true, autoMode: true, fanSpeed: null })).toBe("Auto");
    expect(fanText({ power: false, autoMode: false, fanSpeed: 4 })).toBe("Off");
    expect(fanText({ power: null, autoMode: null, fanSpeed: null })).toBe("–");
  });
});

describe("timeAxis", () => {
  const HOUR = 3_600_000;
  const start = new Date(2026, 10, 6, 11, 37).getTime(); // Local time, whatever the zone.

  it("puts a day's ticks on every third hour", () => {
    const { ticks } = timeAxis(start, start + 24 * HOUR);
    expect(ticks.length).toBeGreaterThanOrEqual(7);
    expect(ticks.length).toBeLessThanOrEqual(8);
    for (const tick of ticks) {
      const date = new Date(tick);
      expect([date.getMinutes(), date.getHours() % 3]).toEqual([0, 0]);
      expect(tick).toBeGreaterThanOrEqual(start);
      expect(tick).toBeLessThanOrEqual(start + 24 * HOUR);
    }
  });

  it("labels midnight with the date and other hours with the time", () => {
    const { ticks, format } = timeAxis(start, start + 62 * HOUR);
    const midnight = ticks.find(tick => new Date(tick).getHours() === 0)!;
    const noon = ticks.find(tick => new Date(tick).getHours() === 12)!;
    expect(format(midnight)).toBe(
      new Date(midnight).toLocaleDateString([], {
        month: "short",
        day: "numeric",
      })
    );
    expect(format(noon)).toBe(
      new Date(noon).toLocaleTimeString([], { hour: "numeric" })
    );
  });

  it("puts a month's ticks at midnight, a few days apart", () => {
    const { ticks, format } = timeAxis(start, start + 30 * 24 * HOUR);
    expect(ticks.length).toBeLessThanOrEqual(8);
    for (const tick of ticks) {
      expect([new Date(tick).getHours(), new Date(tick).getMinutes()]).toEqual([
        0, 0,
      ]);
      expect(format(tick)).toMatch(/\d/);
    }
  });

  it("has no ticks for a single point between hours", () => {
    expect(timeAxis(start, start).ticks).toEqual([]);
  });
});
