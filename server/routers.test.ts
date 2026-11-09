import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DysonAuthError } from "./dyson/appApi";
import { DysonConfigError } from "./dyson/config";
import { controlPurifier } from "./dyson/command";
import { readSchedule } from "./dyson/schedule";
import { SnapshotError } from "./dyson/snapshot";
import { getDb } from "./db";
import { historyRefresher } from "./historyRefresh";
import { storedSlots } from "./historyStore";
import { liveReader } from "./live";
import { addNote, deleteNote, notesPage, notesSince, updateNote } from "./notesStore";
import { storedHistory } from "./readingsStore";
import { appRouter } from "./routers";
import { createMockContext, createViewerContext } from "./testHelpers";

vi.mock("./live", () => ({ liveReader: { get: vi.fn(), readAfterChange: vi.fn() } }));
vi.mock("./dyson/command", () => ({ controlPurifier: vi.fn(), SLEEP_TIMER_MAX: 540 }));
vi.mock("./dyson/schedule", () => ({ readSchedule: vi.fn() }));
vi.mock("./historyRefresh", () => ({
  historyRefresher: { refresh: vi.fn(async () => {}) },
}));
vi.mock("./historyStore", () => ({
  storedSlots: vi.fn(async () => []),
  newestSlotStart: vi.fn(async () => new Date("2026-11-07T21:30:00Z")),
}));
vi.mock("./outdoorStore", () => ({
  storedOutdoor: vi.fn(async () => []),
  latestOutdoor: vi.fn(async () => ({
    measuredAt: new Date("2026-11-08T03:00:00Z"),
    aqi: 49,
    aqiName: "Good",
    pm25: 7,
    pm10: 13,
    no2: 21,
  })),
}));
vi.mock("./notesStore", () => ({
  notesSince: vi.fn(async () => null),
  notesPage: vi.fn(async () => null),
  addNote: vi.fn(async () => null),
  updateNote: vi.fn(async () => null),
  deleteNote: vi.fn(async () => null),
}));
vi.mock("./readingsStore", () => ({
  storedHistory: vi.fn(async () => []),
  latestSyncAt: vi.fn(async () => new Date("2026-11-07T20:34:41Z")),
}));
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
    expect(status).toEqual({
      databaseConfigured: false,
      dysonTokenSource: "DYSON_TOKEN",
      lastSyncAt: null,
      newestSlot: null,
      outdoor: null,
    });
    expect(JSON.stringify(status)).not.toContain("secret-token");
  });

  it("reports when the sync last ran and the newest saved slot", async () => {
    vi.mocked(getDb).mockResolvedValueOnce({} as never);
    expect(await viewer().readings.status()).toMatchObject({
      databaseConfigured: true,
      lastSyncAt: new Date("2026-11-07T20:34:41Z"),
      newestSlot: new Date("2026-11-07T21:30:00Z"),
      outdoor: { aqi: 49, aqiName: "Good", pm25: 7 },
    });
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
      outdoor: [],
    });
    expect(historyRefresher.refresh).not.toHaveBeenCalled();
  });

  it("summarizes days in the viewer's time zone, after copying Dyson's history", async () => {
    vi.mocked(getDb).mockResolvedValueOnce({} as never);
    vi.mocked(storedSlots).mockResolvedValueOnce([
      {
        slotStart: new Date(Date.now() - 60 * 60_000),
        pm25: 40,
        pm10: 41,
        aqi: 40,
        fanSpeed: 6,
        runSeconds: 900,
      },
    ]);
    const daily = await viewer().readings.daily({ timeZone: "America/New_York", days: 7 });
    expect(historyRefresher.refresh).toHaveBeenCalledWith(600_000, 5_000);
    expect(daily.databaseConfigured).toBe(true);
    expect(daily.summaries).toHaveLength(1);
    expect(daily.summaries[0]).toMatchObject({ peakPm25: 40, spike: { clearedMinutes: null } });
  });

  it("refuses an unknown time zone, and has no summaries without a database", async () => {
    await expect(viewer().readings.daily({ timeZone: "Mars/Olympus", days: 7 })).rejects.toThrow(
      "Unknown time zone"
    );
    expect(await viewer().readings.daily({ timeZone: "UTC", days: 7 })).toEqual({
      databaseConfigured: false,
      thresholds: { guideline: 15, spike: 35 },
      summaries: [],
    });
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
      outdoor: [],
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

describe("readings.control", () => {
  const admin = () => appRouter.createCaller(createMockContext("admin"));
  const live = {
    device: { serial: "HJ1-US-TEST000A", name: "Bedroom", productType: "897", model: "SP01-AB", topicRoot: "897", firmwareVersion: null, newVersionAvailable: false },
    reading: { serial: "HJ1-US-TEST000A", nightMode: true } as never,
    cached: false,
    stored: true,
  };

  afterEach(() => {
    vi.mocked(controlPurifier).mockReset();
    vi.mocked(liveReader.readAfterChange).mockReset();
  });

  it("is for admins only", async () => {
    await expect(viewer().readings.control({ nightMode: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(controlPurifier).not.toHaveBeenCalled();
  });

  it("sends the change, then reads the purifier again", async () => {
    vi.mocked(controlPurifier).mockResolvedValue({ confirmed: true, reported: { nmod: "ON" } });
    vi.mocked(liveReader.readAfterChange).mockResolvedValue(live);
    const result = await admin().readings.control({ nightMode: true });
    expect(controlPurifier).toHaveBeenCalledWith({ nightMode: true });
    expect(liveReader.readAfterChange).toHaveBeenCalledOnce();
    expect(result.confirmed).toBe(true);
    expect(result.live.reading).toMatchObject({ nightMode: true });
    expect(result.live.device).toEqual({ name: "Bedroom", model: "SP01-AB", firmwareVersion: null, newVersionAvailable: false });
  });

  it.each([
    [{}, "Nothing to change"],
    [{ fanSpeed: 11 }, ""],
    [{ fanSpeed: 2.5 }, ""],
    [{ sleepTimer: 5 }, "15 to 540"],
    [{ sleepTimer: 600 }, ""],
  ])("refuses %j", async (input, message) => {
    await expect(admin().readings.control(input as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    if (message) await expect(admin().readings.control(input as never)).rejects.toThrow(message);
    expect(controlPurifier).not.toHaveBeenCalled();
  });

  it("explains a failed command without a 401", async () => {
    vi.mocked(controlPurifier).mockRejectedValue(new SnapshotError("Couldn't send the command"));
    await expect(admin().readings.control({ power: false })).rejects.toMatchObject({ code: "BAD_GATEWAY" });
  });
});

describe("readings.schedule", () => {
  it("returns Dyson's schedule to anyone signed in", async () => {
    const schedule = { enabled: true, periods: [] };
    vi.mocked(readSchedule).mockResolvedValue(schedule);
    expect(await viewer().readings.schedule()).toEqual(schedule);
    await expect(appRouter.createCaller(createMockContext(null)).readings.schedule()).rejects.toThrow("Sign in required");
  });
});

describe("notes", () => {
  const admin = () => appRouter.createCaller(createMockContext("admin"));
  const note = {
    category: "cooking" as const,
    startsAt: new Date(Date.now() - 30 * 60_000),
    endsAt: null,
    details: " Stir-fry on the stove ",
  };

  it("shows the notes in a chart range to anyone signed in", async () => {
    const stored = { id: 1, ...note, details: "Stir-fry on the stove" };
    vi.mocked(notesSince).mockResolvedValueOnce([stored]);
    const before = Date.now();
    expect(await viewer().notes.inRange({ range: "24h" })).toEqual({ databaseConfigured: true, notes: [stored] });
    const since = vi.mocked(notesSince).mock.calls[0]![0].getTime();
    expect(since).toBeGreaterThanOrEqual(before - 24 * 3_600_000);
    expect(since).toBeLessThanOrEqual(Date.now() - 24 * 3_600_000);
    await expect(appRouter.createCaller(createMockContext(null)).notes.list({})).rejects.toThrow(
      "Sign in required"
    );
  });

  it("lists notes a page at a time", async () => {
    const next = { startsAt: new Date("2026-11-07T18:00:00Z"), id: 3 };
    vi.mocked(notesPage).mockResolvedValueOnce({ notes: [], next });
    const cursor = { startsAt: new Date("2026-11-08T18:00:00Z"), id: 9 };
    expect(await viewer().notes.list({ cursor, limit: 20 })).toEqual({
      databaseConfigured: true,
      notes: [],
      nextCursor: next,
    });
    expect(notesPage).toHaveBeenCalledWith(cursor, 20);
  });

  it("has no notes without a database", async () => {
    expect(await viewer().notes.inRange({ range: "7d" })).toEqual({ databaseConfigured: false, notes: [] });
    expect(await viewer().notes.list({})).toEqual({ databaseConfigured: false, notes: [], nextCursor: null });
    expect(notesPage).toHaveBeenCalledWith(null, 50);
    await expect(admin().notes.create(note)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Notes need a database, like the history.",
    });
  });

  it("lets only admins add, change or delete notes", async () => {
    await expect(viewer().notes.create(note)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(viewer().notes.update({ id: 1, ...note })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(viewer().notes.delete({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(addNote).not.toHaveBeenCalled();
    expect(updateNote).not.toHaveBeenCalled();
    expect(deleteNote).not.toHaveBeenCalled();
  });

  it("adds, changes and deletes notes for an admin", async () => {
    vi.mocked(addNote).mockResolvedValueOnce(12);
    expect(await admin().notes.create(note)).toEqual({ id: 12 });
    expect(addNote).toHaveBeenCalledWith(note);

    const ended = { ...note, endsAt: new Date(Date.now() - 5 * 60_000) };
    vi.mocked(updateNote).mockResolvedValueOnce(true);
    expect(await admin().notes.update({ id: 12, ...ended })).toEqual({ id: 12 });
    expect(updateNote).toHaveBeenCalledWith(12, ended);

    vi.mocked(deleteNote).mockResolvedValueOnce(true);
    expect(await admin().notes.delete({ id: 12 })).toEqual({ id: 12 });
    expect(deleteNote).toHaveBeenCalledWith(12);
  });

  it("says when a note is gone", async () => {
    vi.mocked(updateNote).mockResolvedValueOnce(false);
    await expect(admin().notes.update({ id: 99, ...note })).rejects.toMatchObject({ code: "NOT_FOUND" });
    vi.mocked(deleteNote).mockResolvedValueOnce(false);
    await expect(admin().notes.delete({ id: 99 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it.each([
    [{ category: "smoking" }, ""],
    [{ startsAt: new Date(Date.now() + 2 * 3_600_000) }, "The start can't be in the future"],
    [{ endsAt: new Date(Date.now() - 60 * 60_000) }, "The end has to be after the start"],
    [{ category: "other", details: "  " }, "Say what happened"],
    [{ details: "x".repeat(5_001) }, ""],
  ])("refuses %j", async (change, message) => {
    const input = { ...note, ...change } as never;
    await expect(admin().notes.create(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    if (message) await expect(admin().notes.create(input)).rejects.toThrow(message);
    expect(addNote).not.toHaveBeenCalled();
  });
});
