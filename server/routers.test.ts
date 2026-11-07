import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DysonAuthError } from "./dyson/appApi";
import { DysonConfigError } from "./dyson/config";
import { SnapshotError } from "./dyson/snapshot";
import { getDb } from "./db";
import { historyRefresher } from "./historyRefresh";
import { storedSlots } from "./historyStore";
import { liveReader } from "./live";
import { storedHistory } from "./readingsStore";
import { appRouter } from "./routers";
import { createMockContext, createViewerContext } from "./testHelpers";

vi.mock("./live", () => ({ liveReader: { get: vi.fn() } }));
vi.mock("./historyRefresh", () => ({
  historyRefresher: { refresh: vi.fn(async () => {}) },
}));
vi.mock("./historyStore", () => ({ storedSlots: vi.fn(async () => []) }));
vi.mock("./readingsStore", () => ({ storedHistory: vi.fn(async () => []) }));
vi.mock("./db", async importOriginal => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: vi.fn(async () => null),
}));

const get = vi.mocked(liveReader.get);
const viewer = () => appRouter.createCaller(createViewerContext());

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  get.mockReset();
  vi.clearAllMocks();
});

describe("readings", () => {
  it("needs a session", async () => {
    const caller = appRouter.createCaller(createMockContext(null));
    await expect(caller.readings.status()).rejects.toThrow("Sign in required");
    await expect(caller.readings.live()).rejects.toThrow("Sign in required");
  });

  it("reports what's configured without revealing the token", async () => {
    vi.stubEnv("DYSON_TOKEN", "secret-token");
    const status = await viewer().readings.status();
    expect(status).toEqual({ databaseConfigured: false, dysonTokenSource: "DYSON_TOKEN" });
    expect(JSON.stringify(status)).not.toContain("secret-token");
  });

  it("returns the live reading, and only what the page needs about the device", async () => {
    get.mockResolvedValue({
      device: {
        serial: "HJ1-US-TEST000A",
        name: "Bedroom",
        productType: "897",
        model: "SP01-AB",
        topicRoot: "897",
        firmwareVersion: "0897PF.00.01.004.0007",
        newVersionAvailable: false,
      },
      reading: { serial: "HJ1-US-TEST000A", pm25: 3 } as never,
      cached: false,
      stored: false,
    });
    const live = await viewer().readings.live();
    expect(get).toHaveBeenCalledWith(60_000);
    expect(live.device).toEqual({
      name: "Bedroom",
      model: "SP01-AB",
      firmwareVersion: "0897PF.00.01.004.0007",
      newVersionAvailable: false,
    });
    expect(live.reading.pm25).toBe(3);

    await viewer().readings.refresh();
    expect(get).toHaveBeenLastCalledWith(10_000);
  });

  it.each([
    [new DysonConfigError("No Dyson token."), "PRECONDITION_FAILED"],
    [new DysonAuthError("Dyson rejected the token", 401), "PRECONDITION_FAILED"],
    [new SnapshotError("The purifier didn't send its state"), "BAD_GATEWAY"],
  ])("turns %s into %s, never a 401", async (error, code) => {
    get.mockRejectedValue(error);
    await expect(viewer().readings.live()).rejects.toMatchObject({ code, message: error.message });
  });

  it("hides the details of unexpected failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    get.mockRejectedValue(new Error("something internal"));
    await expect(viewer().readings.live()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "The live reading failed; the server log has the details.",
    });
  });

  it("has no history without a database, and doesn't reach Dyson for it", async () => {
    expect(await viewer().readings.history({ range: "24h" })).toEqual({
      databaseConfigured: false,
      points: [],
      slots: [],
    });
    expect(historyRefresher.refresh).not.toHaveBeenCalled();
  });

  it("copies Dyson's history before reading the stored history", async () => {
    vi.mocked(getDb).mockResolvedValueOnce({} as never);
    const slot = {
      slotStart: new Date("2026-11-05T02:00:00Z"),
      pm25: 4.9,
      pm10: 4.9,
      aqi: 5,
      fanSpeed: 2,
      runSeconds: 60,
    };
    vi.mocked(storedSlots).mockResolvedValueOnce([slot]);
    const before = Date.now();
    const history = await viewer().readings.history({ range: "7d" });
    expect(historyRefresher.refresh).toHaveBeenCalledWith(600_000, 5_000);
    expect(
      vi.mocked(historyRefresher.refresh).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(storedSlots).mock.invocationCallOrder[0]!);
    const since = vi.mocked(storedSlots).mock.calls[0]![0].getTime();
    expect(since).toBeGreaterThanOrEqual(before - 7 * 24 * 3_600_000);
    expect(vi.mocked(storedHistory).mock.calls[0]![0].getTime()).toBe(since);
    expect(history).toEqual({
      databaseConfigured: true,
      points: [],
      slots: [slot],
    });
  });
});

describe("auth.me", () => {
  it("reports sign-in as off when VIEWER_PASSWORD is unset in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VIEWER_PASSWORD", "");
    const caller = appRouter.createCaller(createMockContext("admin"));
    expect(await caller.auth.me()).toMatchObject({ signInRequired: false, adminEnabled: true });
  });
});
