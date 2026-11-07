import { describe, expect, it, vi } from "vitest";
import type { LiveReading } from "./dyson/live";
import { LiveReader } from "./live";

const sample = { device: { serial: "HJ1-US-TEST000A" }, reading: { pm25: 3 } } as unknown as LiveReading;

function setup(save: () => Promise<boolean> = async () => true) {
  let now = 1_000_000;
  const read = vi.fn(async () => sample);
  const reader = new LiveReader(read, save, () => now);
  return { reader, read, advance: (ms: number) => (now += ms) };
}

describe("LiveReader", () => {
  it("reuses a recent reading and reads again once it's too old", async () => {
    const { reader, read, advance } = setup();
    expect(await reader.get(60_000)).toMatchObject({ cached: false, stored: true });
    advance(30_000);
    expect(await reader.get(60_000)).toMatchObject({ cached: true });
    expect(read).toHaveBeenCalledTimes(1);
    advance(31_000);
    expect(await reader.get(60_000)).toMatchObject({ cached: false });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("shares one read between concurrent callers", async () => {
    const { reader, read } = setup();
    await Promise.all([reader.get(60_000), reader.get(60_000), reader.get(60_000)]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("still returns the reading when storing it fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reader } = setup(async () => {
      throw new Error("database unavailable");
    });
    expect(await reader.get(60_000)).toMatchObject({ stored: false, reading: { pm25: 3 } });
  });

  it("lets the next call retry after a failed read", async () => {
    const { reader, read } = setup();
    read.mockRejectedValueOnce(new Error("offline"));
    await expect(reader.get(60_000)).rejects.toThrow("offline");
    expect(await reader.get(60_000)).toMatchObject({ cached: false });
  });
});
