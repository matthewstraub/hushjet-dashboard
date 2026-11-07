/** Storing Dyson's 15-minute history and reading it back for the charts. */

import { desc, gte, sql } from "drizzle-orm";
import type { MySqlColumn } from "drizzle-orm/mysql-core";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { historySlots, type NewHistorySlotRow } from "../drizzle/schema";
import { getDb } from "./db";
import type { HistorySlot } from "./dyson/history";

/** Rows per INSERT; a full week is 672 slots. */
const BATCH = 500;

export function toHistoryRows(
  serial: string,
  slots: HistorySlot[]
): NewHistorySlotRow[] {
  return slots.map(slot => ({
    serial,
    slotStart: slot.slotStart,
    pm25: slot.pm25,
    pm10: slot.pm10,
    aqi: slot.aqi,
    fanSpeed: slot.fanSpeed,
    runSeconds: slot.runSeconds === null ? null : Math.round(slot.runSeconds),
  }));
}

/** For a slot that's already stored: the new value, or the stored one if Dyson sent none. */
function newOrKept(column: MySqlColumn) {
  const name = sql.identifier(column.name);
  return sql`coalesce(values(${name}), ${name})`;
}

/** One INSERT for some slots, updating any that are already stored. */
export function upsertSlots(db: MySql2Database, rows: NewHistorySlotRow[]) {
  return db
    .insert(historySlots)
    .values(rows)
    .onDuplicateKeyUpdate({
      set: {
        pm25: newOrKept(historySlots.pm25),
        pm10: newOrKept(historySlots.pm10),
        aqi: newOrKept(historySlots.aqi),
        fanSpeed: newOrKept(historySlots.fanSpeed),
        runSeconds: newOrKept(historySlots.runSeconds),
      },
    });
}

/**
 * Store slots, updating the ones already stored, since the newest slot fills
 * in over its 15 minutes. Returns how many slots were written, or null when
 * no database is configured.
 */
export async function saveHistory(
  serial: string,
  slots: HistorySlot[]
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = toHistoryRows(serial, slots);
  for (let i = 0; i < rows.length; i += BATCH) {
    await upsertSlots(db, rows.slice(i, i + BATCH));
  }
  return rows.length;
}

/**
 * Stored slots since a time, oldest first. Null when no database is
 * configured. 30 days is 2,880 slots.
 */
export async function storedSlots(
  since: Date,
  limit = 5_000
): Promise<HistorySlot[] | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({
      slotStart: historySlots.slotStart,
      pm25: historySlots.pm25,
      pm10: historySlots.pm10,
      aqi: historySlots.aqi,
      fanSpeed: historySlots.fanSpeed,
      runSeconds: historySlots.runSeconds,
    })
    .from(historySlots)
    .where(gte(historySlots.slotStart, since))
    .orderBy(desc(historySlots.slotStart))
    .limit(limit);
  return rows.reverse();
}
