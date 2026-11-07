/**
 * Read the purifier now, through Dyson's cloud: the device list, fresh IoT
 * credentials, then one snapshot. About three seconds end to end.
 */

import { DysonAppApi } from "./appApi";
import { cloudAuthFromResponse } from "./cloud";
import { loadDysonConfig } from "./config";
import { chooseDevice, DeviceSelectionError, deviceFromManifest, type Device } from "./devices";
import type { Reading } from "./messages";
import { takeSnapshot, type ConnectFn } from "./snapshot";

export interface LiveReading {
  device: Device;
  reading: Reading;
}

export interface ReadOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  connect?: ConnectFn;
  timeoutMs?: number;
}

export async function readPurifier(options: ReadOptions = {}): Promise<LiveReading> {
  const config = loadDysonConfig(options.env);
  const api = new DysonAppApi({
    token: config.token,
    baseUrl: config.baseUrl,
    userAgent: config.userAgent,
    fetch: options.fetch,
  });
  const device = chooseDevice((await api.manifest()).map(deviceFromManifest), config.serial);
  const topicRoot = device.topicRoot ?? device.productType;
  if (!topicRoot) {
    throw new DeviceSelectionError(`The manifest gives no MQTT topic prefix for ${device.serial}`);
  }
  const auth = cloudAuthFromResponse(await api.iotCredentials(device.serial));
  const reading = await takeSnapshot({
    auth,
    serial: device.serial,
    topicRoot,
    connect: options.connect,
    timeoutMs: options.timeoutMs,
  });
  return { device, reading };
}
