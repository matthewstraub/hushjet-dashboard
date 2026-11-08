/**
 * Copies Dyson's 15-minute history into the database when the dashboard asks
 * for history, at most once per gap. `pnpm sync` does the same on a schedule,
 * but GitHub runs scheduled workflows late or skips them, and Dyson's copy
 * covers only the last seven days; this way looking at the page fills any gap.
 */

import {
  readHistory,
  type HistoryResult,
  type HistorySlot,
} from "./dyson/history";
import type { OutdoorAir } from "./dyson/outdoor";
import { saveHistory } from "./historyStore";
import { saveOutdoor } from "./outdoorStore";

export class HistoryRefresher {
  private lastAttempt: number | null = null;
  private pending: Promise<void> | null = null;

  constructor(
    private readonly read: () => Promise<HistoryResult> = () => readHistory(),
    private readonly save: (
      serial: string,
      slots: HistorySlot[]
    ) => Promise<number | null> = saveHistory,
    private readonly clock: () => number = Date.now,
    private readonly saveAir: (serial: string, air: OutdoorAir) => Promise<boolean> = saveOutdoor
  ) {}

  /**
   * Copy the history unless that was tried in the last minGapMs, waiting at
   * most waitMs so a slow Dyson doesn't hold up the charts; the copy carries
   * on in the background. Never throws: stored history is still worth showing.
   */
  async refresh(minGapMs: number, waitMs: number): Promise<void> {
    // A copy already running is waited for, gap or not: the charts and the
    // daily summary load together, and both should see what it copies.
    if (!this.pending) {
      if (this.lastAttempt !== null && this.clock() - this.lastAttempt < minGapMs) return;
      // Counted from the start, so a failing Dyson is tried once per gap, not on every page load.
      this.lastAttempt = this.clock();
      this.pending = this.copy().finally(() => {
        this.pending = null;
      });
    }
    const copying = this.pending;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      copying,
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, waitMs);
      }),
    ]);
    clearTimeout(timer);
  }

  private async copy(): Promise<void> {
    try {
      const { device, slots, outdoor, outdoorError } = await this.read();
      await this.save(device.serial, slots);
      // Dyson's outdoor figures come with the history; they're extra, so only a note if missing.
      if (outdoor) await this.saveAir(device.serial, outdoor);
      else if (outdoorError) console.warn("[History] No outdoor air from Dyson:", outdoorError);
    } catch (error) {
      console.warn(
        "[History] Couldn't copy Dyson's history:",
        error instanceof Error ? error.message : error
      );
    }
  }
}

export const historyRefresher = new HistoryRefresher();
