import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PATH_MANIFEST, PATH_PROVISION } from "./appApi";
import { parseHistory, readHistory, resolutionMinutes } from "./history";
import {
  fakeFetch,
  jsonResponse,
  MANIFEST_ENTRY,
  SERIAL,
  TOKEN,
} from "./testData";

// 16 slots cut from a real HJ10 week: four before it was set up, then twelve.
const WEEK = JSON.parse(
  fs.readFileSync(
    path.join(import.meta.dirname, "fixtures", "environmentdata-week.json"),
    "utf8"
  )
);

describe("parseHistory", () => {
  it("turns the series into timed slots, skipping empty ones", () => {
    const slots = parseHistory(WEEK);
    expect(slots).toHaveLength(12);
    expect(slots[0]).toEqual({
      slotStart: new Date("2026-11-05T02:00:00Z"),
      pm25: 4.9,
      pm10: 4.9,
      aqi: 5,
      fanSpeed: 2,
      runSeconds: 60,
    });
    expect(slots[1]!.slotStart).toEqual(new Date("2026-11-05T02:15:00Z"));
    expect(slots.at(-1)!.slotStart).toEqual(new Date("2026-11-05T04:45:00Z"));
    expect(
      slots.every(slot => slot.runSeconds !== null && slot.runSeconds <= 900)
    ).toBe(true);
  });

  it("keeps a slot that has only some of the series", () => {
    const slots = parseHistory({
      start_time: "2026-11-01T05:00:00Z",
      resolution: "PT15M",
      p25m: [null, 3.2],
      fnsp: [null, null],
    });
    expect(slots).toEqual([
      {
        slotStart: new Date("2026-11-01T05:15:00Z"),
        pm25: 3.2,
        pm10: null,
        aqi: null,
        fanSpeed: null,
        runSeconds: null,
      },
    ]);
  });

  it("refuses a response without a start time", () => {
    expect(() => parseHistory({ resolution: "PT15M", p25m: [1] })).toThrow(
      "no start_time"
    );
  });
});

describe("resolutionMinutes", () => {
  it.each([
    ["PT15M", 15],
    ["PT1H", 60],
    ["PT1H30M", 90],
    [15, 15],
  ])("reads %j as %i minutes", (value, minutes) => {
    expect(resolutionMinutes(value)).toBe(minutes);
  });

  it("refuses nonsense", () => {
    for (const value of [undefined, "", "P1D", "15 minutes", 0]) {
      expect(() => resolutionMinutes(value)).toThrow("unexpected resolution");
    }
  });
});

describe("readHistory", () => {
  const historyPath = `/v1/messageprocessor/devices/${SERIAL}/environmentdata/daily`;
  const outdoorPath = `/v1/environment/devices/${SERIAL}/data`;
  const OUTDOOR = { DateTime: "2026-11-08T03:00:00Z", AqiValue: 49, AqiName: "Good", Pm25Value: 7 };

  it("finds the HushJet and asks for its history and outdoor air over HTTPS only", async () => {
    const { fetch, calls } = fakeFetch(url => {
      if (url.pathname === PATH_PROVISION) return jsonResponse("5.0.21061");
      if (url.pathname === PATH_MANIFEST) return jsonResponse([MANIFEST_ENTRY]);
      if (url.pathname === historyPath) return jsonResponse(WEEK);
      if (url.pathname === outdoorPath) return jsonResponse(OUTDOOR);
      return new Response(null, { status: 404 });
    });
    const result = await readHistory({ env: { DYSON_TOKEN: TOKEN }, fetch });
    expect(calls.map(call => call.url.pathname)).toEqual([PATH_PROVISION, PATH_MANIFEST, historyPath, outdoorPath]);
    expect(calls.at(-1)!.url.searchParams.get("language")).toBe("en");
    expect(result.device.serial).toBe(SERIAL);
    expect(result.slots).toHaveLength(12);
    expect(result.outdoor).toMatchObject({ aqi: 49, pm25: 7 });
  });

  it("keeps the history when the outdoor air fails", async () => {
    const { fetch } = fakeFetch(url => {
      if (url.pathname === PATH_PROVISION) return jsonResponse("5.0.21061");
      if (url.pathname === PATH_MANIFEST) return jsonResponse([MANIFEST_ENTRY]);
      if (url.pathname === historyPath) return jsonResponse(WEEK);
      return new Response(null, { status: 500 });
    });
    const result = await readHistory({ env: { DYSON_TOKEN: TOKEN }, fetch });
    expect(result.slots).toHaveLength(12);
    expect(result.outdoor).toBeNull();
    expect(result.outdoorError).toBe("GET /v1/environment/devices/{serial}/data returned 500");
  });

  it("keeps the serial out of error messages, which CI prints publicly", async () => {
    const { fetch } = fakeFetch(url => {
      if (url.pathname === PATH_PROVISION) return jsonResponse("5.0.21061");
      if (url.pathname === PATH_MANIFEST) return jsonResponse([MANIFEST_ENTRY]);
      return new Response(null, { status: 500 });
    });
    const error = await readHistory({ env: { DYSON_TOKEN: TOKEN }, fetch }).catch(e => e as Error);
    expect(error.message).toBe("GET /v1/messageprocessor/devices/{serial}/environmentdata/daily returned 500");
    expect(error.message).not.toContain(SERIAL);
  });

  it("returns no slots when Dyson has no history", async () => {
    const { fetch } = fakeFetch(url => {
      if (url.pathname === PATH_PROVISION) return jsonResponse("5.0.21061");
      if (url.pathname === PATH_MANIFEST) return jsonResponse([MANIFEST_ENTRY]);
      return new Response(null, { status: 204 });
    });
    expect(
      (await readHistory({ env: { DYSON_TOKEN: TOKEN }, fetch })).slots
    ).toEqual([]);
  });
});
