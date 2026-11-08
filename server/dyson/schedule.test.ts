import { describe, expect, it } from "vitest";
import { PATH_MANIFEST, PATH_PROVISION } from "./appApi";
import { parseSchedule, readSchedule } from "./schedule";
import { fakeFetch, jsonResponse, MANIFEST_ENTRY, SERIAL, TOKEN } from "./testData";

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const settings = (nmod: string) => ({ fnsp: "AUTO", fdir: "OFF", oson: "OFF", nmod, auto: "ON" });

// A real HJ10's schedule, serial replaced: auto all day, night mode overnight.
const SCHEDULE = {
  serial: SERIAL,
  enabled: true,
  events: [
    { groupId: 2, weeklyRepeat: true, days: ALL_DAYS, enabled: true, startTime: "10:05:00", settings: settings("OFF") },
    { groupId: 2, weeklyRepeat: true, days: ALL_DAYS, enabled: true, startTime: "22:00:00", settings: settings("OFF") },
    { groupId: 3, weeklyRepeat: true, days: ALL_DAYS, enabled: true, startTime: "22:05:00", settings: settings("ON") },
    { groupId: 3, weeklyRepeat: true, days: [1, 2, 3, 4, 5, 6, 0], enabled: true, startTime: "10:00:00", settings: settings("ON") },
  ],
};

describe("parseSchedule", () => {
  it("pairs each group's events into a period, in the order they start", () => {
    expect(parseSchedule(SCHEDULE)).toEqual({
      enabled: true,
      periods: [
        {
          days: ALL_DAYS,
          start: "10:05",
          end: "22:00",
          enabled: true,
          repeats: true,
          settings: { fan: "auto", nightMode: false, power: null },
        },
        {
          days: ALL_DAYS,
          start: "22:05",
          end: "10:00",
          enabled: true,
          repeats: true,
          settings: { fan: "auto", nightMode: true, power: null },
        },
      ],
    });
  });

  it("reads speeds, power, single events and a schedule that's off", () => {
    const schedule = parseSchedule({
      enabled: false,
      events: [
        { days: [1, 2, 3, 4, 5], startTime: "7:30:00", settings: { fnsp: "0004", auto: "OFF", fpwr: "ON" } },
        { enabled: false, startTime: "nonsense" },
      ],
    });
    expect(schedule).toEqual({
      enabled: false,
      periods: [
        {
          days: [1, 2, 3, 4, 5],
          start: "07:30",
          end: null,
          enabled: true,
          repeats: true,
          settings: { fan: 4, nightMode: null, power: true },
        },
      ],
    });
  });
});

describe("readSchedule", () => {
  it("asks Dyson for the purifier's schedule by serial and product type", async () => {
    const path = `/v1/unifiedscheduler/${SERIAL}/events`;
    const { fetch, calls } = fakeFetch(url => {
      if (url.pathname === PATH_PROVISION) return jsonResponse("5.0.21061");
      if (url.pathname === PATH_MANIFEST) return jsonResponse([MANIFEST_ENTRY]);
      if (url.pathname === path) return jsonResponse(SCHEDULE);
      return new Response(null, { status: 404 });
    });
    const schedule = await readSchedule({ env: { DYSON_TOKEN: TOKEN }, fetch });
    expect(calls.at(-1)!.url.searchParams.get("productType")).toBe("897");
    expect(schedule.periods).toHaveLength(2);
  });
});
