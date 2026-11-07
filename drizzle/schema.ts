import {
  boolean,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  smallint,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * One row per reading: the purifier's state and sensor data at one moment,
 * from `pnpm sync` or a live read on the dashboard. The flat columns are what
 * the dashboard charts; `state` and `sensor` keep every field the purifier
 * sent, known or not. Times are UTC (see server/db.ts).
 */
export const readings = mysqlTable(
  "readings",
  {
    // Like the other dashboards' tables on TiDB.
    id: int("id").autoincrement().primaryKey(),
    takenAt: datetime("taken_at", { mode: "date", fsp: 3 }).notNull(),
    serial: varchar("serial", { length: 32 }).notNull(),
    /** "sync" for the scheduled job, "dashboard" for a live read. */
    source: varchar("source", { length: 16 }).notNull(),
    power: boolean("power"),
    fanSpeed: smallint("fan_speed"),
    autoMode: boolean("auto_mode"),
    nightMode: boolean("night_mode"),
    monitoring: boolean("monitoring"),
    fanState: varchar("fan_state", { length: 16 }),
    hepaFilterPct: smallint("hepa_filter_pct"),
    carbonFilterPct: smallint("carbon_filter_pct"),
    pm25: smallint("pm25"),
    pm10: smallint("pm10"),
    sensorStatus: varchar("sensor_status", { length: 8 }),
    state: json("state").$type<Record<string, unknown>>().notNull(),
    sensor: json("sensor").$type<Record<string, unknown>>().notNull(),
  },
  table => [index("readings_by_time").on(table.serial, table.takenAt)]
);

export type ReadingRow = typeof readings.$inferSelect;
export type NewReadingRow = typeof readings.$inferInsert;
