/** Shaping stored history for the charts. */

/** The length of one slot of Dyson's history. */
export const SLOT_MS = 15 * 60_000;

export interface SlotInput {
  slotStart: Date | string;
  pm25: number | null;
  pm10: number | null;
  fanSpeed: number | null;
  runSeconds: number | null;
}

export interface SlotRow {
  t: number;
  pm25: number | null;
  pm10: number | null;
  fan: number | null;
  /** Minutes the fan ran during the slot, out of 15. */
  ranMinutes: number | null;
  /** True for the empty rows that mark gaps. */
  gap?: true;
}

/**
 * Chart rows for Dyson's 15-minute slots, oldest first. Where slots are
 * missing, as when the purifier was unplugged, an empty row breaks the lines
 * instead of drawing them straight across the gap.
 */
export function slotRows(slots: SlotInput[]): SlotRow[] {
  const rows: SlotRow[] = [];
  let previous: number | null = null;
  for (const slot of slots) {
    const t = new Date(slot.slotStart).getTime();
    if (previous !== null && t - previous > SLOT_MS) {
      rows.push({
        t: previous + SLOT_MS,
        pm25: null,
        pm10: null,
        fan: null,
        ranMinutes: null,
        gap: true,
      });
    }
    rows.push({
      t,
      pm25: slot.pm25,
      pm10: slot.pm10,
      fan: slot.fanSpeed,
      ranMinutes:
        slot.runSeconds === null ? null : Math.round(slot.runSeconds / 60),
    });
    previous = t;
  }
  return rows;
}

/** One of Dyson's hourly outdoor figures; see server/dyson/outdoor.ts. */
export interface OutdoorInput {
  measuredAt: Date | string;
  pm25: number | null;
}

export type SlotRowWithOutdoor = SlotRow & {
  /** The outdoor figure for the hour this slot is in, if that hour was saved. */
  outdoor: number | null;
  /** One chart point per saved hour, on the row at that hour's start. */
  outdoorPoint: number | null;
};

const HOUR_MS = 60 * 60_000;

/**
 * Slot rows with Dyson's outdoor PM2.5 alongside: each hour's figure for the
 * slots in that hour (`outdoor`), and one chart point per saved hour, at the
 * hour itself (`outdoorPoint`). Where the history has no row at that time,
 * the point gets a row of its own, marked as a gap so tables skip it; that's
 * only ever where the indoor line already breaks. Dyson only gives the
 * current hour, so an hour is saved only if a copy happens during it. Rows
 * must be oldest first, as slotRows returns them.
 */
export function withOutdoor(rows: SlotRow[], outdoor: OutdoorInput[]): SlotRowWithOutdoor[] {
  const hours = outdoor
    .map(hour => ({ t: new Date(hour.measuredAt).getTime(), pm25: hour.pm25 }))
    .sort((a, b) => a.t - b.t);
  let index = -1;
  const filled: SlotRowWithOutdoor[] = rows.map(row => {
    while (index + 1 < hours.length && hours[index + 1]!.t <= row.t) index++;
    const hour = index >= 0 ? hours[index]! : null;
    const current = hour && !row.gap && row.t - hour.t < HOUR_MS;
    return { ...row, outdoor: current ? hour.pm25 : null, outdoorPoint: null };
  });

  const byTime = new Map(filled.map(row => [row.t, row]));
  const own: SlotRowWithOutdoor[] = [];
  for (const hour of hours) {
    if (hour.pm25 === null) continue;
    const row = byTime.get(hour.t);
    if (row) row.outdoorPoint = hour.pm25;
    else {
      own.push({
        t: hour.t,
        pm25: null,
        pm10: null,
        fan: null,
        ranMinutes: null,
        gap: true,
        outdoor: null,
        outdoorPoint: hour.pm25,
      });
    }
  }
  return own.length ? [...filled, ...own].sort((a, b) => a.t - b.t) : filled;
}
