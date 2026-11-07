import { describe, expect, it, vi } from "vitest";
import { cloudAuthFromResponse } from "./cloud";
import {
  CURRENT_STATE,
  REQUEST_FAULTS,
  REQUEST_SENSOR_DATA,
  REQUEST_STATE,
  SENSOR_DATA,
  STATE_CHANGE,
} from "./messages";
import { commandTime, takeSnapshot, type ConnectFn } from "./snapshot";
import {
  capturePayloads,
  FakeMqttClient,
  FAULTS_REPORT,
  IOT_RESPONSE,
  REAL_CAPTURE,
  SERIAL,
  type FakeBehavior,
} from "./testData";

const auth = cloudAuthFromResponse(IOT_RESPONSE);
const payloads = capturePayloads(REAL_CAPTURE) as Array<{ msg: string }>;
const state = payloads.find(p => p.msg === CURRENT_STATE)!;
const sensor = payloads.find(p => p.msg === SENSOR_DATA)!;
const now = () => new Date("2026-11-07T00:08:54.758Z");

function run(behavior: FakeBehavior, timeoutMs = 2000, faultsWaitMs = 2000) {
  const fake = new FakeMqttClient(behavior);
  const connect = vi.fn<ConnectFn>(() => fake);
  const result = takeSnapshot({
    auth,
    serial: SERIAL,
    topicRoot: "897",
    connect,
    timeoutMs,
    faultsWaitMs,
    now,
  });
  return { fake, connect, result };
}

describe("takeSnapshot", () => {
  it("asks for state, sensor data and faults, and resolves once all three arrive", async () => {
    const { fake, connect, result } = run({ replies: [state, sensor, FAULTS_REPORT] });
    const reading = await result;

    const [url, options] = connect.mock.calls[0]!;
    expect(url).toBe(`wss://${IOT_RESPONSE.Endpoint}/mqtt`);
    expect(options).toMatchObject({ clientId: auth.clientId, protocolVersion: 4, reconnectPeriod: 0 });
    expect(fake.subscriptions).toEqual([`897/${SERIAL}/status/current`, `897/${SERIAL}/status/faults`]);
    expect(fake.published.map(p => [p.topic, JSON.parse(p.message)])).toEqual([
      [`897/${SERIAL}/command`, { msg: REQUEST_STATE, time: "2026-11-07T00:08:54Z" }],
      [`897/${SERIAL}/command`, { msg: REQUEST_SENSOR_DATA, time: "2026-11-07T00:08:54Z" }],
      [`897/${SERIAL}/command`, { msg: REQUEST_FAULTS, time: "2026-11-07T00:08:54Z" }],
    ]);
    expect(reading.faults?.problems).toEqual([]);
    expect(reading.wifiSignal).toBe(-38);
    expect(reading).toMatchObject({
      serial: SERIAL,
      takenAt: "2026-11-07T00:08:54.758Z",
      pm25: 3,
      pm10: 2,
      hepaFilterPct: 100,
      carbonFilterPct: 100,
      power: true,
    });
    expect(fake.ended).toBe(true);
  });

  it("asks again for a fault report that doesn't come, then does without it", async () => {
    const { fake, result } = run({ replies: [state, sensor] }, 2000, 20);
    const reading = await result;
    expect(reading.pm25).toBe(3);
    expect(reading.faults).toBeNull();
    const asked = fake.published.map(p => JSON.parse(p.message).msg);
    expect(asked.filter(msg => msg === REQUEST_FAULTS)).toHaveLength(2);
  });

  it("gets the fault report when the purifier answers the second request", async () => {
    const replyTo = (request: string, attempt: number) =>
      request === REQUEST_FAULTS && attempt === 2 ? [FAULTS_REPORT] : [];
    const { result } = run({ replies: [state, sensor], replyTo });
    expect((await result).faults?.problems).toEqual([]);
  });

  it("asks again for state that doesn't come", async () => {
    const replyTo = (request: string, attempt: number) =>
      request === REQUEST_STATE && attempt === 2 ? [state, FAULTS_REPORT] : [];
    const fake = new FakeMqttClient({ replies: [sensor], replyTo });
    const reading = await takeSnapshot({
      auth,
      serial: SERIAL,
      topicRoot: "897",
      connect: () => fake,
      timeoutMs: 2000,
      retryAfterMs: 20,
      now,
    });
    expect(reading.power).toBe(true);
    const asked = fake.published.map(p => JSON.parse(p.message).msg);
    expect(asked).toEqual([REQUEST_STATE, REQUEST_SENSOR_DATA, REQUEST_FAULTS, REQUEST_STATE]);
  });

  it("gives up when the purifier doesn't answer", async () => {
    const { fake, result } = run({ replies: [] }, 50);
    await expect(result).rejects.toThrow("didn't send its state or sensor data within 0.05s");
    expect(fake.ended).toBe(true);
  });

  it("waits for a full state, not just a STATE-CHANGE", async () => {
    const change = { msg: STATE_CHANGE, "product-state": { fpwr: ["OFF", "ON"] } };
    const { result } = run({ replies: [change, sensor] }, 50);
    await expect(result).rejects.toThrow("didn't send its state within");
  });

  it("explains a refused websocket handshake", async () => {
    const { result } = run({ refuse: new Error("Unexpected server response: 401") });
    await expect(result).rejects.toThrow("turned down the IoT credentials");
  });

  it("reports other connection errors and a refused subscription", async () => {
    await expect(run({ refuse: new Error("getaddrinfo ENOTFOUND x") }).result).rejects.toThrow(
      "Couldn't connect to Dyson's cloud (getaddrinfo ENOTFOUND x)"
    );
    await expect(run({ subscribeError: new Error("Not authorized") }).result).rejects.toThrow(
      "refused the subscription (Not authorized)"
    );
  });
});

describe("commandTime", () => {
  it("drops the milliseconds, as the purifier expects", () => {
    expect(commandTime(new Date("2026-11-07T00:08:54.758Z"))).toBe("2026-11-07T00:08:54Z");
  });
});
