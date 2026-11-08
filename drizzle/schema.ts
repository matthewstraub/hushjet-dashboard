import {
  boolean,
  datetime,
  double,
  index,
  int,
  json,
  mysqlTable,
  smallint,
  uniqueIndex,
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

/**
 * Dyson's 15-minute history of the purifier, one row per slot: averages over
 * the slot, as the MyDyson app charts them (see server/dyson/history.ts).
 * Dyson keeps only the current week, so `pnpm sync` and the dashboard copy it
 * here, updating the newest slot as it fills in. Times are UTC.
 */
export const historySlots = mysqlTable(
  "history_slots",
  {
    id: int("id").autoincrement().primaryKey(),
    serial: varchar("serial", { length: 32 }).notNull(),
    slotStart: datetime("slot_start", { mode: "date" }).notNull(),
    pm25: double("pm25"),
    pm10: double("pm10"),
    /** Dyson's air quality index. */
    aqi: double("aqi"),
    /** Average fan speed, 1 to 10. */
    fanSpeed: double("fan_speed"),
    /** Seconds the fan ran, out of the slot's 900. */
    runSeconds: smallint("run_seconds"),
  },
  table => [
    uniqueIndex("history_slots_by_time").on(table.serial, table.slotStart),
  ]
);

export type HistorySlotRow = typeof historySlots.$inferSelect;
export type NewHistorySlotRow = typeof historySlots.$inferInsert;

/**
 * Dyson's hourly outdoor air figures for the purifier's area (see
 * server/dyson/outdoor.ts), one row per hour, copied along with the history.
 * The place name isn't stored. Times are UTC.
 */
export const outdoorReadings = mysqlTable(
  "outdoor_readings",
  {
    id: int("id").autoincrement().primaryKey(),
    serial: varchar("serial", { length: 32 }).notNull(),
    measuredAt: datetime("measured_at", { mode: "date" }).notNull(),
    aqi: smallint("aqi"),
    /** The AQI's band, like "Good". */
    aqiName: varchar("aqi_name", { length: 64 }),
    pm25: double("pm25"),
    pm10: double("pm10"),
    /** Dyson doesn't say which unit. */
    no2: double("no2"),
  },
  table => [uniqueIndex("outdoor_readings_by_time").on(table.serial, table.measuredAt)]
);

export type NewOutdoorReadingRow = typeof outdoorReadings.$inferInsert;
