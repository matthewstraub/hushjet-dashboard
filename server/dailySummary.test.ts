import { describe, expect, it } from "vitest";
import type { HistorySlot } from "./dyson/history";
import { isTimeZone, localDate, summarizeDays } from "./dailySummary";

const NY = "America/New_York";
// Saturday, Nov 7, 5 PM in New York.
const NOW = new Date("2026-11-07T22:00:00Z");

function slot(iso: string, pm25: number | null, fanSpeed = 2, runSeconds = 900): HistorySlot {
  return { slotStart: new Date(iso), pm25, pm10: pm25, aqi: pm25, fanSpeed, runSeconds };
}

// Real 15-minute averages: the Nov 5 evening spike (7 PM in New York is
// midnight UTC) and the smaller one on Nov 7.
const SLOTS: HistorySlot[] = [
  slot("2026-11-05T23:30:00Z", 2.0, 1, 900),
  slot("2026-11-05T23:45:00Z", 2.2, 1, 900),
  slot("2026-11-06T00:00:00Z", 98.5, 4),
  slot("2026-11-06T00:15:00Z", 104.7, 4),
  slot("2026-11-06T00:30:00Z", 65.6, 4),
  slot("2026-11-06T00:45:00Z", 42.6, 4),
  slot("2026-11-06T01:00:00Z", 26.6, 4),
  slot("2026-11-06T01:15:00Z", 20.8, 4),
  slot("2026-11-06T01:30:00Z", 16.8, 4),
  slot("2026-11-06T01:45:00Z", 10.1, 4),
  slot("2026-11-06T02:00:00Z", 4.6, 4),
  slot("2026-11-06T17:00:00Z", 3.0, 1, 450),
  slot("2026-11-07T16:00:00Z", 43.7, 7),
  slot("2026-11-07T16:15:00Z", 31.5, 7),
  slot("2026-11-07T16:30:00Z", 3.4, 3),
];

describe("summarizeDays", () => {
  const days = summarizeDays(SLOTS, NY, 7, NOW);

  it("groups slots by local day, newest first", () => {
    expect(days.map(day => [day.date, day.today, day.slots])).toEqual([
      ["2026-11-07", true, 3],
      ["2026-11-06", false, 1],
      ["2026-11-05", false, 11],
    ]);
  });

  it("measures the Nov 5 spike: its peak, time above 15 and how long it took to clear", () => {
    expect(days[2]).toMatchObject({
      peakPm25: 104.7,
      peakAt: new Date("2026-11-06T00:15:00Z"),
      minutesAbove: 7 * 15,
      // From 7:15 PM to the 10.1 at 8:45 PM.
      spike: { clearedMinutes: 90 },
      avgPm25: 35.9,
    });
  });

  it("leaves out spikes below 35 and sums what the fan did", () => {
    expect(days[1]).toMatchObject({ spike: null, minutesAbove: 0, avgFanSpeed: 1, fanHours: 0.1 });
    expect(days[0]).toMatchObject({ spike: { clearedMinutes: 30 }, minutesAbove: 30, avgFanSpeed: 5.7, fanHours: 0.8 });
  });

  it("says a spike hasn't cleared when no later slot is under 15", () => {
    const [today] = summarizeDays(SLOTS.slice(0, -1), NY, 7, NOW);
    expect(today!.spike).toEqual({ clearedMinutes: null });
  });

  it("keeps only the last few days", () => {
    expect(summarizeDays(SLOTS, NY, 2, NOW).map(day => day.date)).toEqual(["2026-11-07", "2026-11-06"]);
  });

  it("uses the time zone it's given", () => {
    expect(summarizeDays(SLOTS, "UTC", 7, NOW).map(day => [day.date, day.slots])).toEqual([
      ["2026-11-07", 3],
      ["2026-11-06", 10],
      ["2026-11-05", 2],
    ]);
  });

  it("skips slots without PM2.5 in the PM figures", () => {
    const [day] = summarizeDays([slot("2026-11-07T15:00:00Z", null), slot("2026-11-07T15:15:00Z", 4)], NY, 7, NOW);
    expect(day).toMatchObject({ slots: 1, avgPm25: 4, peakPm25: 4, fanHours: 0.5 });
  });
});

describe("localDate and isTimeZone", () => {
  it("puts 4:30 UTC on the previous day in New York", () => {
    expect(localDate(new Date("2026-11-06T04:30:00Z"), NY)).toBe("2026-11-05");
    expect(localDate(new Date("2026-11-06T04:30:00Z"), "UTC")).toBe("2026-11-06");
  });

  it("knows real time zones", () => {
    expect([isTimeZone(NY), isTimeZone("UTC"), isTimeZone("Mars/Olympus")]).toEqual([true, true, false]);
  });
});
