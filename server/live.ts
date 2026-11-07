/**
 * The dashboard's live reading. One read through Dyson's cloud takes about
 * three seconds, so the result is kept briefly and concurrent page loads share
 * one read. Every fresh reading is also stored when a database is configured.
 */

import { readPurifier, type LiveReading } from "./dyson/live";
import type { Reading } from "./dyson/messages";
import { saveReading } from "./readingsStore";

export interface LiveResult extends LiveReading {
  /** True when this is the kept result rather than a new read. */
  cached: boolean;
  /** True when the reading was written to the database. */
  stored: boolean;
}

export class LiveReader {
  private last: { at: number; result: LiveResult } | null = null;
  private pending: Promise<LiveResult> | null = null;

  constructor(
    private readonly read: () => Promise<LiveReading> = () => readPurifier(),
    private readonly save: (reading: Reading) => Promise<boolean> = reading =>
      saveReading(reading, "dashboard"),
    private readonly clock: () => number = Date.now
  ) {}

  /** The kept reading if it's younger than maxAgeMs, otherwise a fresh one. */
  get(maxAgeMs: number): Promise<LiveResult> {
    if (this.last && this.clock() - this.last.at < maxAgeMs) {
      return Promise.resolve({ ...this.last.result, cached: true });
    }
    this.pending ??= this.fresh().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async fresh(): Promise<LiveResult> {
    const live = await this.read();
    let stored = false;
    try {
      stored = await this.save(live.reading);
    } catch (error) {
      // A database hiccup shouldn't hide a good reading.
      console.warn("[Readings] Couldn't store the live reading:", error instanceof Error ? error.message : error);
    }
    const result: LiveResult = { ...live, cached: false, stored };
    this.last = { at: this.clock(), result };
    return result;
  }
}

export const liveReader = new LiveReader();
