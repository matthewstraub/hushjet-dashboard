/** Storing readings and reading back their history. */

import { desc, gte } from "drizzle-orm";
import { readings, type NewReadingRow } from "../drizzle/schema";
import { getDb } from "./db";
import type { Reading } from "./dyson/messages";

export type ReadingSource = "sync" | "dashboard";

export function toRow(reading: Reading, source: ReadingSource): NewReadingRow {
  return {
    takenAt: new Date(reading.takenAt),
    serial: reading.serial,
    source,
    power: reading.power,
    fanSpeed: reading.fanSpeed,
    autoMode: reading.autoMode,
    nightMode: reading.nightMode,
    monitoring: reading.monitoring,
    fanState: reading.fanState,
    hepaFilterPct: reading.hepaFilterPct,
    carbonFilterPct: reading.carbonFilterPct,
    pm25: reading.pm25,
    pm10: reading.pm10,
    sensorStatus: reading.sensorStatus,
    state: reading.state,
    sensor: reading.sensor,
  };
}

/** Store one reading. Returns false when no database is configured. */
export async function saveReading(reading: Reading, source: ReadingSource): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.insert(readings).values(toRow(reading, source));
  return true;
}

export interface HistoryPoint {
  takenAt: Date;
  pm25: number | null;
  pm10: number | null;
  hepaFilterPct: number | null;
  carbonFilterPct: number | null;
}

/**
 * The newest readings since a time, oldest first, for the charts. Null when
 * no database is configured. 30 days of 15-minute syncs is about 2,900 rows.
 */
export async function storedHistory(since: Date, limit = 10_000): Promise<HistoryPoint[] | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({
      takenAt: readings.takenAt,
      pm25: readings.pm25,
      pm10: readings.pm10,
      hepaFilterPct: readings.hepaFilterPct,
      carbonFilterPct: readings.carbonFilterPct,
    })
    .from(readings)
    .where(gte(readings.takenAt, since))
    .orderBy(desc(readings.takenAt))
    .limit(limit);
  return rows.reverse();
}
