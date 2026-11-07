import { describe, expect, it } from "vitest";
import {
  asFlag,
  asInt,
  CURRENT_STATE,
  newest,
  SENSOR_DATA,
  serialFromTopic,
  Snapshot,
  STATE_CHANGE,
} from "./messages";
import { capturePayloads, REAL_CAPTURE, SERIAL, SYNTHETIC_CAPTURE } from "./testData";

function replay(file: string) {
  const snapshot = new Snapshot();
  const kinds = capturePayloads(file)
    .map(payload => snapshot.apply(payload))
    .filter(kind => kind !== null);
  return { snapshot, kinds };
}

describe("a real HJ10 capture", () => {
  it("reads the same values as the Python CLI", () => {
    const { snapshot, kinds } = replay(REAL_CAPTURE);
    expect(kinds).toEqual([CURRENT_STATE, ...Array(5).fill(SENSOR_DATA)]);

    const reading = snapshot.reading(SERIAL, "2026-11-07T00:10:25.075Z");
    expect(reading).toMatchObject({
      serial: SERIAL,
      takenAt: "2026-11-07T00:10:25.075Z",
      power: true,
      fanSpeed: 4,
      autoMode: false,
      nightMode: true,
      monitoring: true,
      fanState: "FAN",
      hepaFilterPct: 100,
      carbonFilterPct: 100,
      pm25: 3,
      pm10: 2,
      sensorStatus: null,
    });
    // Unknown fields are kept, like the HJ10's filter types.
    expect(reading.state).toMatchObject({ hflt: "EHEP", cflt: "CARF", nmdv: "0000" });
    expect(reading.sensor).toMatchObject({ p25r: "0003", p10r: "0003" });
  });
});

describe("the synthetic session", () => {
  it("follows STATE-CHANGE pairs, auto speed and the sensor switching off", () => {
    const { snapshot, kinds } = replay(SYNTHETIC_CAPTURE);
    expect(kinds.filter(kind => kind === STATE_CHANGE)).toHaveLength(2);
    expect(snapshot.reading(SERIAL, "2026-11-06T18:01:30.000Z")).toMatchObject({
      power: false,
      autoMode: true,
      fanSpeed: null,
      monitoring: false,
      fanState: "OFF",
      hepaFilterPct: 97,
      carbonFilterPct: 95,
      pm25: null,
      pm10: null,
      sensorStatus: "OFF",
    });
  });
});

describe("Snapshot.apply", () => {
  it("replaces state on CURRENT-STATE and merges it on STATE-CHANGE", () => {
    const snapshot = new Snapshot();
    snapshot.apply({ msg: CURRENT_STATE, "product-state": { fpwr: "ON", fnsp: "0004" } });
    snapshot.apply({ msg: STATE_CHANGE, "product-state": { fnsp: ["0004", "0007"] } });
    expect(snapshot.state).toEqual({ fpwr: "ON", fnsp: "0007" });
    snapshot.apply({ msg: CURRENT_STATE, "product-state": { fpwr: "OFF" } });
    expect(snapshot.state).toEqual({ fpwr: "OFF" });
  });

  it("treats fnsp AUTO as auto mode when the auto field is missing", () => {
    const snapshot = new Snapshot();
    snapshot.apply({ msg: CURRENT_STATE, "product-state": { fnsp: "AUTO" } });
    expect(snapshot.reading(SERIAL, "t")).toMatchObject({ autoMode: true, fanSpeed: null });
  });

  it("ignores messages without state or sensor data", () => {
    const snapshot = new Snapshot();
    for (const payload of [null, "text", [], { msg: "HELLO" }, { msg: CURRENT_STATE }, { msg: SENSOR_DATA, data: [] }]) {
      expect(snapshot.apply(payload)).toBeNull();
    }
    expect(snapshot.state).toEqual({});
  });
});

describe("value helpers", () => {
  it.each([
    ["0004", 4],
    [" 12 ", 12],
    ["0100", 100],
    [7, 7],
    ["AUTO", null],
    ["INV", null],
    ["OFF", null],
    ["", null],
    [true, null],
    [1.5, null],
    [null, null],
  ])("asInt(%j) is %j", (value, expected) => {
    expect(asInt(value)).toBe(expected);
  });

  it("reads ON and OFF as flags and nothing else", () => {
    expect([asFlag("ON"), asFlag(" off "), asFlag("AUTO"), asFlag(1)]).toEqual([true, false, null, null]);
  });

  it("takes the new value from [old, new] pairs", () => {
    expect([newest(["OFF", "ON"]), newest([]), newest("ON")]).toEqual(["ON", null, "ON"]);
  });

  it("finds the serial in a topic", () => {
    expect(serialFromTopic(`897/${SERIAL}/status/current`)).toBe(SERIAL);
    expect(serialFromTopic("897")).toBeNull();
  });
});
