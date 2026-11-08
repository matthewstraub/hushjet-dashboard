import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceFromManifest } from "./dyson/devices";
import type { HistoryResult, HistorySlot } from "./dyson/history";
import { MANIFEST_ENTRY, SERIAL } from "./dyson/testData";
import { HistoryRefresher } from "./historyRefresh";

const GAP = 10 * 60_000;
const SLOTS: HistorySlot[] = [
  {
    slotStart: new Date("2026-11-05T02:00:00Z"),
    pm25: 4.9,
    pm10: 4.9,
    aqi: 5,
    fanSpeed: 2,
    runSeconds: 60,
  },
];

function setup() {
  let now = 1_000_000;
  const read = vi.fn(async (): Promise<HistoryResult> => ({
    device: deviceFromManifest(MANIFEST_ENTRY),
    slots: SLOTS,
  }));
  const save = vi.fn(
    async (_serial: string, slots: HistorySlot[]) => slots.length
  );
  const refresher = new HistoryRefresher(read, save, () => now);
  return { read, save, refresher, advance: (ms: number) => (now += ms) };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("HistoryRefresher", () => {
  it("copies the history, then not again until the gap has passed", async () => {
    const { read, save, refresher, advance } = setup();
    await refresher.refresh(GAP, 5_000);
    expect(save).toHaveBeenCalledWith(SERIAL, SLOTS);

    advance(GAP - 1);
    await refresher.refresh(GAP, 5_000);
    expect(read).toHaveBeenCalledOnce();

    advance(1);
    await refresher.refresh(GAP, 5_000);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("shares one copy between concurrent page loads", async () => {
    const { read, refresher } = setup();
    await Promise.all([
      refresher.refresh(GAP, 5_000),
      refresher.refresh(GAP, 5_000),
    ]);
    expect(read).toHaveBeenCalledOnce();
  });

  it("makes a request that arrives during a copy wait for it", async () => {
    const { read, save, refresher } = setup();
    let finish!: () => void;
    read.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = () => resolve({ device: deviceFromManifest(MANIFEST_ENTRY), slots: SLOTS });
        })
    );
    const done: string[] = [];
    const first = refresher.refresh(GAP, 5_000).then(() => done.push("first"));
    const second = refresher.refresh(GAP, 5_000).then(() => done.push("second"));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(done).toEqual([]);

    finish();
    await Promise.all([first, second]);
    expect(save).toHaveBeenCalledOnce();
    expect(done.sort()).toEqual(["first", "second"]);
  });

  it("doesn't throw, and waits out the gap after a failure too", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { read, save, refresher, advance } = setup();
    read.mockRejectedValue(new Error("Dyson rejected the token"));
    await expect(refresher.refresh(GAP, 5_000)).resolves.toBeUndefined();
    expect(save).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      "[History] Couldn't copy Dyson's history:",
      "Dyson rejected the token"
    );

    advance(60_000);
    await refresher.refresh(GAP, 5_000);
    expect(read).toHaveBeenCalledOnce();
  });

  it("stops waiting for a slow Dyson, and the copy finishes in the background", async () => {
    vi.useFakeTimers();
    const { read, save, refresher } = setup();
    let finish!: () => void;
    read.mockImplementation(
      () =>
        new Promise(
          resolve =>
            (finish = () =>
              resolve({
                device: deviceFromManifest(MANIFEST_ENTRY),
                slots: SLOTS,
              }))
        )
    );
    const waiting = refresher.refresh(GAP, 5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await waiting;
    expect(save).not.toHaveBeenCalled();

    finish();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
  });
});
