/** Storing Dyson's outdoor air figures and reading them back. */

import { desc, gte } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { outdoorReadings, type NewOutdoorReadingRow } from "../drizzle/schema";
import { getDb } from "./db";
import type { OutdoorAir } from "./dyson/outdoor";
import { newOrKept } from "./historyStore";

export function toOutdoorRow(serial: string, air: OutdoorAir): NewOutdoorReadingRow {
  return {
    serial,
    measuredAt: air.measuredAt,
    aqi: air.aqi === null ? null : Math.round(air.aqi),
    aqiName: air.aqiName,
    pm25: air.pm25,
    pm10: air.pm10,
    no2: air.no2,
  };
}

/** One INSERT for an hour's figures, updating them if that hour is already stored. */
export function upsertOutdoor(db: MySql2Database, row: NewOutdoorReadingRow) {
  return db
    .insert(outdoorReadings)
    .values(row)
    .onDuplicateKeyUpdate({
      set: {
        aqi: newOrKept(outdoorReadings.aqi),
        aqiName: newOrKept(outdoorReadings.aqiName),
        pm25: newOrKept(outdoorReadings.pm25),
        pm10: newOrKept(outdoorReadings.pm10),
        no2: newOrKept(outdoorReadings.no2),
      },
    });
}

/** Store an hour's figures. Returns false when no database is configured. */
export async function saveOutdoor(serial: string, air: OutdoorAir): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await upsertOutdoor(db, toOutdoorRow(serial, air));
  return true;
}

const COLUMNS = {
  measuredAt: outdoorReadings.measuredAt,
  aqi: outdoorReadings.aqi,
  aqiName: outdoorReadings.aqiName,
  pm25: outdoorReadings.pm25,
  pm10: outdoorReadings.pm10,
  no2: outdoorReadings.no2,
};

/** Stored hours since a time, oldest first. Null when no database is configured. */
export async function storedOutdoor(since: Date, limit = 2_000): Promise<OutdoorAir[] | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select(COLUMNS)
    .from(outdoorReadings)
    .where(gte(outdoorReadings.measuredAt, since))
    .orderBy(desc(outdoorReadings.measuredAt))
    .limit(limit);
  return rows.reverse();
}

/** The newest stored hour, or null when there's none or no database. */
export async function latestOutdoor(): Promise<OutdoorAir | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select(COLUMNS).from(outdoorReadings).orderBy(desc(outdoorReadings.measuredAt)).limit(1);
  return row ?? null;
}
