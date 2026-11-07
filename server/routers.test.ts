import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DysonAuthError } from "./dyson/appApi";
import { DysonConfigError } from "./dyson/config";
import { SnapshotError } from "./dyson/snapshot";
import { liveReader } from "./live";
import { appRouter } from "./routers";
import { createMockContext, createViewerContext } from "./testHelpers";

vi.mock("./live", () => ({ liveReader: { get: vi.fn() } }));

const get = vi.mocked(liveReader.get);
const viewer = () => appRouter.createCaller(createViewerContext());

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  get.mockReset();
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

  it("has no history without a database", async () => {
    expect(await viewer().readings.history({ range: "24h" })).toEqual({ databaseConfigured: false, points: [] });
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
