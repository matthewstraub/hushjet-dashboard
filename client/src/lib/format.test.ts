import { describe, expect, it } from "vitest";
import { fanText, onOffText, percentText, pmText } from "./format";

describe("format", () => {
  it("shows PM values, or the sensor's word when it isn't measuring", () => {
    expect([pmText(3, null), pmText(0, null), pmText(null, "OFF"), pmText(null, null), pmText(undefined, undefined)]).toEqual([
      "3",
      "0",
      "off",
      "–",
      "–",
    ]);
  });

  it("shows percentages and on/off", () => {
    expect([percentText(100), percentText(0), percentText(null)]).toEqual(["100%", "0%", "–"]);
    expect([onOffText(true), onOffText(false), onOffText(null)]).toEqual(["On", "Off", "–"]);
  });

  it("describes the fan", () => {
    expect(fanText({ power: true, autoMode: false, fanSpeed: 4 })).toBe("Speed 4");
    expect(fanText({ power: true, autoMode: true, fanSpeed: null })).toBe("Auto");
    expect(fanText({ power: false, autoMode: false, fanSpeed: 4 })).toBe("Off");
    expect(fanText({ power: null, autoMode: null, fanSpeed: null })).toBe("–");
  });
});
