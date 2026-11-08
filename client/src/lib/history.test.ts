import { describe, expect, it } from "vitest";
import { slotRows, withOutdoor } from "./history";

const slot = (iso: string, pm25: number | null = 2.5) => ({
  slotStart: new Date(iso),
  pm25,
  pm10: pm25,
  fanSpeed: 2,
  runSeconds: 540,
});

describe("slotRows", () => {
  it("turns slots into chart rows, with minutes the fan ran", () => {
    expect(
      slotRows([
        slot("2026-11-05T02:00:00Z"),
        slot("2026-11-05T02:15:00Z", 1.4),
      ])
    ).toEqual([
      {
        t: Date.parse("2026-11-05T02:00:00Z"),
        pm25: 2.5,
        pm10: 2.5,
        fan: 2,
        ranMinutes: 9,
      },
      {
        t: Date.parse("2026-11-05T02:15:00Z"),
        pm25: 1.4,
        pm10: 1.4,
        fan: 2,
        ranMinutes: 9,
      },
    ]);
  });

  it("breaks the lines where slots are missing", () => {
    const rows = slotRows([
      slot("2026-11-05T02:00:00Z"),
      slot("2026-11-05T03:00:00Z"),
    ]);
    expect(
      rows.map(row => [new Date(row.t).toISOString(), row.pm25, row.gap])
    ).toEqual([
      ["2026-11-05T02:00:00.000Z", 2.5, undefined],
      ["2026-11-05T02:15:00.000Z", null, true],
      ["2026-11-05T03:00:00.000Z", 2.5, undefined],
    ]);
  });

  it("accepts times as strings", () => {
    expect(
      slotRows([
        { ...slot("2026-11-05T02:00:00Z"), slotStart: "2026-11-05T02:00:00Z" },
      ])[0]!.t
    ).toBe(Date.parse("2026-11-05T02:00:00Z"));
  });
});

describe("withOutdoor", () => {
  it("gives each slot its hour's outdoor figure, and none once the hour has passed", () => {
    const rows = slotRows([
      slot("2026-11-08T02:45:00Z"),
      slot("2026-11-08T03:00:00Z"),
      slot("2026-11-08T03:45:00Z"),
      slot("2026-11-08T04:00:00Z"),
      slot("2026-11-08T05:00:00Z"),
    ]);
    const outdoor = [
      { measuredAt: "2026-11-08T04:00:00Z", pm25: 9 },
      { measuredAt: new Date("2026-11-08T03:00:00Z"), pm25: 7 },
    ];
    expect(
      withOutdoor(rows, outdoor).map(row => [new Date(row.t).toISOString().slice(11, 16), row.outdoor, row.outdoorPoint])
    ).toEqual([
      ["02:45", null, null],
      ["03:00", 7, 7],
      ["03:15", null, null], // the gap row for the missing slots
      ["03:45", 7, null], // the same hour: no second point
      ["04:00", 9, 9],
      ["04:15", null, null], // the gap row before 05:00
      ["05:00", null, null],
    ]);
  });
});
