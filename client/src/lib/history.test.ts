import { describe, expect, it } from "vitest";
import { slotRows } from "./history";

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
