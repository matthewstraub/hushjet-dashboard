/** Entries from /v3/manifest, and picking the HushJet among them. */

import { isObject, type JsonObject } from "./appApi";

export const HUSHJET_PRODUCT_TYPE = "897";
// A real HJ10's v3 manifest gives its model as SP01-AB, not HJ10.
export const HUSHJET_MODEL_PREFIXES = ["SP01", "HJ10", "M4P"];

export interface Device {
  serial: string;
  name: string | null;
  productType: string | null;
  model: string | null;
  /** The MQTT topic prefix: mqttRootTopicLevel, else the product type. */
  topicRoot: string | null;
  firmwareVersion: string | null;
  newVersionAvailable: boolean | null;
}

/** The account has no device the dashboard can use, or more than one. */
export class DeviceSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceSelectionError";
  }
}

function text(value: unknown): string | null {
  return value === null || value === undefined || value === "" ? null : String(value);
}

function object(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

export function deviceFromManifest(raw: JsonObject): Device {
  const connected = object(raw.connectedConfiguration);
  const firmware = object(connected.firmware);
  const mqtt = object(connected.mqtt);
  const productType = text(raw.type);
  return {
    serial: text(raw.serialNumber) ?? "",
    name: text(raw.name),
    productType,
    model: text(raw.model),
    topicRoot: text(mqtt.mqttRootTopicLevel) ?? productType,
    firmwareVersion: text(firmware.version),
    newVersionAvailable:
      typeof firmware.newVersionAvailable === "boolean" ? firmware.newVersionAvailable : null,
  };
}

export function isHushJet(device: Device): boolean {
  if (device.productType === HUSHJET_PRODUCT_TYPE || device.topicRoot === HUSHJET_PRODUCT_TYPE) {
    return true;
  }
  const model = (device.model ?? "").toUpperCase();
  return HUSHJET_MODEL_PREFIXES.some(prefix => model.startsWith(prefix));
}

/** The device named by serial, else the account's one HushJet. */
export function chooseDevice(devices: Device[], serial?: string | null): Device {
  if (serial) {
    const match = devices.find(device => device.serial.toUpperCase() === serial.toUpperCase());
    if (!match) throw new DeviceSelectionError(`No device with serial ${serial} on this account`);
    return match;
  }
  const hushjets = devices.filter(isHushJet);
  if (hushjets.length === 1) return hushjets[0]!;
  if (hushjets.length > 1) {
    const serials = hushjets.map(device => device.serial).join(", ");
    throw new DeviceSelectionError(`More than one HushJet (${serials}); set DYSON_SERIAL`);
  }
  const found =
    devices.map(device => `${device.serial} (type ${device.productType ?? "?"})`).join(", ") ||
    "none";
  throw new DeviceSelectionError(
    `No HushJet (product type 897) on this account (found: ${found}); ` +
      "set DYSON_SERIAL to use another purifier"
  );
}
