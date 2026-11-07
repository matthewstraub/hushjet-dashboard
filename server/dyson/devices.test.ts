import { describe, expect, it } from "vitest";
import { chooseDevice, DeviceSelectionError, deviceFromManifest, isHushJet } from "./devices";
import { MANIFEST_ENTRY, SERIAL } from "./testData";

describe("deviceFromManifest", () => {
  it("normalizes a real HJ10 entry", () => {
    expect(deviceFromManifest(MANIFEST_ENTRY)).toEqual({
      serial: SERIAL,
      name: "Bedroom",
      productType: "897",
      model: "SP01-AB",
      topicRoot: "897",
      firmwareVersion: "0897PF.00.01.004.0007",
      newVersionAvailable: false,
    });
  });

  it("falls back to the product type for the topic prefix", () => {
    const entry = structuredClone(MANIFEST_ENTRY) as Record<string, any>;
    delete entry.connectedConfiguration.mqtt.mqttRootTopicLevel;
    expect(deviceFromManifest(entry).topicRoot).toBe("897");
  });

  it("recognizes the HJ10 by its model when the type is missing", () => {
    const device = { ...deviceFromManifest(MANIFEST_ENTRY), productType: null, topicRoot: null };
    expect(isHushJet(device)).toBe(true);
  });
});

describe("chooseDevice", () => {
  const hushjet = deviceFromManifest(MANIFEST_ENTRY);
  const pureCool = { ...hushjet, serial: "TP4-US-OTHER00A", productType: "438", topicRoot: "438", model: "TP04" };

  it("picks the HushJet, or the serial asked for", () => {
    expect(chooseDevice([pureCool, hushjet])).toBe(hushjet);
    expect(chooseDevice([pureCool, hushjet], "tp4-us-other00a")).toBe(pureCool);
  });

  it("explains what's wrong", () => {
    expect(() => chooseDevice([hushjet], "NOPE")).toThrow("No device with serial NOPE");
    expect(() => chooseDevice([hushjet, { ...hushjet, serial: "HJ1-US-TEST000B" }])).toThrow("set DYSON_SERIAL");
    expect(() => chooseDevice([pureCool])).toThrow(DeviceSelectionError);
    expect(() => chooseDevice([])).toThrow("found: none");
  });
});
