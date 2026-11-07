/**
 * Test data for the Dyson client: the real HJ10 capture the Python CLI's tests
 * use, real-shaped API responses with synthetic secrets, and a fake MQTT
 * client that answers like the purifier.
 */

import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { SnapshotClient } from "./snapshot";

export const FIXTURES = path.resolve(import.meta.dirname, "../../cli/tests/fixtures");
export const REAL_CAPTURE = "hj10_0897PF.00.01.004.0007_cloud.jsonl";
export const SYNTHETIC_CAPTURE = "synthetic_hj10_session.jsonl";

// Synthetic values; none of these belong to a real account or device.
export const SERIAL = "HJ1-US-TEST000A";
export const TOKEN = "token-0123456789abcdef";

/** The payloads a recorded session received, in order. */
export function capturePayloads(file: string): unknown[] {
  return fs
    .readFileSync(path.join(FIXTURES, file), "utf8")
    .split("\n")
    .filter(line => line.trim())
    .map(line => JSON.parse(line))
    .filter(record => record.dir === "in" && record.payload !== undefined)
    .map(record => record.payload);
}

/** A /v3/manifest entry shaped like a real HJ10's, with the serial and credential swapped out. */
export const MANIFEST_ENTRY = {
  serialNumber: SERIAL,
  name: "Bedroom",
  type: "897",
  connectedConfiguration: {
    mqtt: {
      remoteBrokerType: "wss",
      localBrokerCredentials: "not-a-real-credential",
      mqttRootTopicLevel: "897",
    },
    firmware: {
      version: "0897PF.00.01.004.0007",
      autoUpdateEnabled: true,
      newVersionAvailable: false,
      capabilities: ["EnvironmentalData", "ExtendedAQ", "Scheduling", "ChangeWifi"],
      minimumAppVersion: "6.4.25340",
    },
  },
  variant: null,
  model: "SP01-AB",
  category: "ec",
  connectionCategory: "lecAndWifi",
  productName: "Dyson HushJet™ Purifier Compact HJ10",
  countryCode: "US",
};

/** Shaped like libdyson-rest's IoTData: ClientId and TokenValue are UUIDs. */
export const IOT_RESPONSE = {
  Endpoint: "example-ats.iot.us-east-1.amazonaws.com",
  IoTCredentials: {
    ClientId: "c1d2e3f4-0000-4000-8000-0000000000c1",
    CustomAuthorizerName: "TestAuthorizer",
    TokenKey: "token",
    TokenSignature: "dGVzdC1zaWduYXR1cmU=",
    TokenValue: "a1b2c3d4-0000-4000-8000-0000000000aa",
  },
};

/** A real HJ10 fault report, all clear, from asking it REQUEST-CURRENT-FAULTS. */
export const FAULTS_REPORT = {
  msg: "CURRENT-FAULTS",
  time: "2026-11-07T21:47:51.000Z",
  "product-errors": { com2: "OK", iuh0: "OK", iuu0: "OK", fs01: "OK", sen1: "OK", amf5: "OK" },
  "product-warnings": { fltr: "OK" },
  "module-errors": {
    szme: "OK",
    szmw: "OK",
    szps: "OK",
    szpe: "OK",
    szpw: "OK",
    szed: "OK",
    lspd: "OK",
    szpi: "OK",
    szpp: "OK",
    szhv: "OK",
    szbv: "OK",
    szav: "OK",
  },
  "module-warnings": {
    srnk: "OK",
    stac: "OK",
    strs: "OK",
    srmi: "OK",
    srmu: "OK",
    nwcs: "OK",
    nwts: "OK",
    nwps: "OK",
    nwss: "OK",
  },
};

export interface FakeBehavior {
  /** Payloads to send back after the first command, like the HJ10 does. */
  replies?: unknown[];
  /** Payloads to send back for one request, given how many times it's been asked. */
  replyTo?: (request: string, attempt: number) => unknown[];
  /** Fail the connection with this error instead of connecting. */
  refuse?: Error;
  subscribeError?: Error;
}

/** Stands in for an MQTT.js client connected to Dyson's cloud. */
export class FakeMqttClient extends EventEmitter implements SnapshotClient {
  subscriptions: string[] = [];
  published: { topic: string; message: string }[] = [];
  ended = false;

  constructor(private readonly behavior: FakeBehavior = {}) {
    super();
    setImmediate(() => {
      if (behavior.refuse) this.emit("error", behavior.refuse);
      else this.emit("connect");
    });
  }

  subscribe(topics: string[], callback: (error: Error | null) => void) {
    this.subscriptions.push(...topics);
    setImmediate(() => callback(this.behavior.subscribeError ?? null));
    return this;
  }

  publish(topic: string, message: string) {
    this.published.push({ topic, message });
    const request = (JSON.parse(message) as { msg: string }).msg;
    const attempt = this.published.filter(p => p.message.includes(`"${request}"`)).length;
    const replies = [
      ...(this.published.length === 1 ? (this.behavior.replies ?? []) : []),
      ...(this.behavior.replyTo?.(request, attempt) ?? []),
    ];
    for (const reply of replies) {
      // Fault reports come on their own topic, like the HJ10 sends them.
      const kind = (reply as { msg?: string }).msg === "CURRENT-FAULTS" ? "faults" : "current";
      const replyTopic = topic.replace(/\/command$/, `/status/${kind}`);
      setImmediate(() => this.emit("message", replyTopic, Buffer.from(JSON.stringify(reply))));
    }
    return this;
  }

  end() {
    this.ended = true;
    this.emit("close");
    return this;
  }
}

type FetchHandler = (url: URL, init: RequestInit) => Response | Promise<Response>;

/** A fetch that answers from a handler and records every request. */
export function fakeFetch(handler: FetchHandler) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  }) as typeof fetch;
  return { fetch: fn, calls };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
