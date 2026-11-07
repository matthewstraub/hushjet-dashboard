import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { resolveAuthState } from "./_core/session";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, viewerProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { DysonApiError, DysonAuthError } from "./dyson/appApi";
import { DysonConfigError, dysonTokenSource } from "./dyson/config";
import { DeviceSelectionError } from "./dyson/devices";
import { SnapshotError } from "./dyson/snapshot";
import { historyRefresher } from "./historyRefresh";
import { storedSlots } from "./historyStore";
import { liveReader } from "./live";
import { storedHistory } from "./readingsStore";

/** How long page loads reuse a live reading. */
export const LIVE_MAX_AGE_MS = 60_000;
/** The shortest gap between live reads when someone presses Refresh. */
export const REFRESH_MIN_GAP_MS = 10_000;
/** How often loading the charts copies Dyson's history, and how long it waits for that. */
export const HISTORY_COPY_GAP_MS = 10 * 60_000;
export const HISTORY_COPY_WAIT_MS = 5_000;

const HOUR_MS = 60 * 60 * 1000;
export const HISTORY_RANGES = {
  "24h": 24 * HOUR_MS,
  "7d": 7 * 24 * HOUR_MS,
  "30d": 30 * 24 * HOUR_MS,
} as const;

/**
 * Turn a failed live read into a message the page can show. Never
 * UNAUTHORIZED: the browser treats a 401 as an expired site session and
 * sends you to sign-in, when it's Dyson's token that needs attention.
 */
export function dysonError(error: unknown): TRPCError {
  if (error instanceof TRPCError) return error;
  if (
    error instanceof DysonConfigError ||
    error instanceof DysonAuthError ||
    error instanceof DeviceSelectionError
  ) {
    return new TRPCError({ code: "PRECONDITION_FAILED", message: error.message, cause: error });
  }
  if (error instanceof SnapshotError || error instanceof DysonApiError) {
    return new TRPCError({ code: "BAD_GATEWAY", message: error.message, cause: error });
  }
  console.error("[Readings] Live read failed:", error);
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "The live reading failed; the server log has the details.",
  });
}

async function liveReading(maxAgeMs: number) {
  try {
    const { device, reading, cached, stored } = await liveReader.get(maxAgeMs);
    return {
      device: {
        name: device.name,
        model: device.model,
        firmwareVersion: device.firmwareVersion,
        newVersionAvailable: device.newVersionAvailable,
      },
      reading,
      cached,
      stored,
    };
  } catch (error) {
    throw dysonError(error);
  }
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    /** Who the client is signed in as, and whether sign-in is on at all. */
    me: publicProcedure.query(({ ctx }) => {
      const state = resolveAuthState();
      return {
        role: ctx.role,
        adminEnabled: state.mode === "open" || (state.mode === "enforced" && state.adminEnabled),
        signInRequired: state.mode !== "open",
      };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  readings: router({
    /** What's set up: a database for history, and where the Dyson token comes from. */
    status: viewerProcedure.query(async () => ({
      databaseConfigured: (await getDb()) !== null,
      dysonTokenSource: dysonTokenSource(),
    })),
    /** The purifier right now, read through Dyson's cloud and reused for a minute. */
    live: viewerProcedure.query(() => liveReading(LIVE_MAX_AGE_MS)),
    /** Read again now, unless a read finished in the last few seconds. */
    refresh: viewerProcedure.mutation(() => liveReading(REFRESH_MIN_GAP_MS)),
    /**
     * What the charts show: Dyson's 15-minute history and the stored
     * readings, after copying Dyson's newest slots (every ten minutes at
     * most). Empty without a database.
     */
    history: viewerProcedure
      .input(z.object({ range: z.enum(["24h", "7d", "30d"]) }))
      .query(async ({ input }) => {
        if (!(await getDb())) return { databaseConfigured: false, points: [], slots: [] };
        await historyRefresher.refresh(HISTORY_COPY_GAP_MS, HISTORY_COPY_WAIT_MS);
        const since = new Date(Date.now() - HISTORY_RANGES[input.range]);
        const [points, slots] = await Promise.all([storedHistory(since), storedSlots(since)]);
        return { databaseConfigured: true, points: points ?? [], slots: slots ?? [] };
      }),
  }),
});

export type AppRouter = typeof appRouter;
