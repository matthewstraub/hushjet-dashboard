import { describe, expect, it, vi } from "vitest";
import { cloudAuthFromResponse } from "./cloud";
import { sendStateSet, stateSetData } from "./command";
import type { ConnectFn } from "./snapshot";
import { FakeMqttClient, IOT_RESPONSE, SERIAL, type FakeBehavior } from "./testData";

const auth = cloudAuthFromResponse(IOT_RESPONSE);
const now = () => new Date("2026-11-08T17:30:00.123Z");

function send(behavior: FakeBehavior, data: Record<string, string>, timeoutMs = 2000) {
  const fake = new FakeMqttClient(behavior);
  const connect = vi.fn<ConnectFn>(() => fake);
  const result = sendStateSet({ auth, serial: SERIAL, topicRoot: "897", data, connect, timeoutMs, now });
  return { fake, result };
}

describe("stateSetData", () => {
  it("maps the dashboard's changes to the purifier's fields", () => {
    expect(stateSetData({ power: true, nightMode: false, monitoring: true })).toEqual({
      fpwr: "ON",
      nmod: "OFF",
      rhtm: "ON",
    });
    expect(stateSetData({ fanSpeed: 4 })).toEqual({ fnsp: "0004", auto: "OFF" });
    expect(stateSetData({ auto: true })).toEqual({ auto: "ON" });
    expect(stateSetData({ sleepTimer: 30 })).toEqual({ sltm: "0030" });
    expect(stateSetData({ sleepTimer: 0 })).toEqual({ sltm: "OFF" });
    expect(stateSetData({})).toEqual({});
  });
});

describe("sendStateSet", () => {
  it("publishes one STATE-SET and resolves once the purifier reports the new values", async () => {
    const change = { msg: "STATE-CHANGE", "product-state": { auto: ["ON", "OFF"], fnsp: ["AUTO", "0004"] } };
    const { fake, result } = send({ replies: [change] }, { fnsp: "0004", auto: "OFF" });
    await expect(result).resolves.toEqual({ confirmed: true, reported: { auto: "OFF", fnsp: "0004" } });
    expect(fake.subscriptions).toEqual([`897/${SERIAL}/status/current`]);
    expect(fake.published.map(p => [p.topic, JSON.parse(p.message)])).toEqual([
      [
        `897/${SERIAL}/command`,
        { msg: "STATE-SET", time: "2026-11-08T17:30:00Z", "mode-reason": "RAPP", data: { fnsp: "0004", auto: "OFF" } },
      ],
    ]);
    expect(fake.ended).toBe(true);
  });

  it("isn't confirmed when the purifier doesn't report the values in time", async () => {
    const unrelated = { msg: "STATE-CHANGE", "product-state": { fnst: ["FAN", "FAN"] } };
    const { result } = send({ replies: [unrelated] }, { nmod: "ON" }, 50);
    await expect(result).resolves.toEqual({ confirmed: false, reported: {} });
  });

  it("fails when Dyson refuses the subscription", async () => {
    const { result } = send({ subscribeError: new Error("Not authorized") }, { nmod: "ON" });
    await expect(result).rejects.toThrow("refused the subscription (Not authorized)");
  });
});
