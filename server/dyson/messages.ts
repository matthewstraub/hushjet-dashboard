/**
 * Turn the purifier's MQTT messages into a flat reading. A port of
 * cli/src/hushjet/messages.py; both are tested against the same captures in
 * cli/tests/fixtures/.
 *
 * - CURRENT-STATE: {"msg", "time", "product-state": {field: "VALUE"}}
 * - STATE-CHANGE: {"msg", "time", "product-state": {field: ["OLD", "NEW"]}}
 * - ENVIRONMENTAL-CURRENT-SENSOR-DATA: {"msg", "time", "data": {field: "VALUE"}}
 *
 * A real HJ10 sends fpwr, auto, fnsp, fnst, nmod, nmdv, rhtm, sltm, hflr and
 * cflr (filter life percent), and hflt and cflt (filter types) in its state,
 * and pm25, pm10, p25r, p10r and sltm as sensor data. Numbers arrive as zero
 * padded strings ("0004"). A sensor reports OFF, INIT or FAIL instead of a
 * number when it isn't measuring. Every field is kept, known or not.
 */

export const CURRENT_STATE = "CURRENT-STATE";
export const STATE_CHANGE = "STATE-CHANGE";
export const SENSOR_DATA = "ENVIRONMENTAL-CURRENT-SENSOR-DATA";
export const REQUEST_STATE = "REQUEST-CURRENT-STATE";
export const REQUEST_SENSOR_DATA = "REQUEST-PRODUCT-ENVIRONMENT-CURRENT-SENSOR-DATA";

export const SENSOR_STATUSES = ["OFF", "INIT", "FAIL"] as const;

export type Fields = Record<string, unknown>;

/** Everything known about the purifier at one moment. */
export interface Reading {
  serial: string;
  /** When the reading was taken, as an ISO timestamp. */
  takenAt: string;
  power: boolean | null;
  fanSpeed: number | null;
  autoMode: boolean | null;
  nightMode: boolean | null;
  monitoring: boolean | null;
  fanState: string | null;
  hepaFilterPct: number | null;
  carbonFilterPct: number | null;
  pm25: number | null;
  pm10: number | null;
  /** OFF, INIT or FAIL when the PM sensor isn't giving numbers. */
  sensorStatus: string | null;
  state: Fields;
  sensor: Fields;
}

/** STATE-CHANGE sends [old, new]; the other messages send the value itself. */
export function newest(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? value[value.length - 1] : null;
  return value;
}

/** "0004" -> 4. Anything that isn't a plain number (AUTO, INV, OFF) -> null. */
export function asInt(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return null;
}

export function asFlag(value: unknown): boolean | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toUpperCase();
  if (text === "ON") return true;
  if (text === "OFF") return false;
  return null;
}

export function asText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** "897/<serial>/status/current" -> "<serial>". */
export function serialFromTopic(topic: string): string | null {
  const parts = topic.split("/");
  return parts.length > 2 && parts[1] ? parts[1] : null;
}

export function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function newestOf(fields: Fields): Fields {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, newest(value)]));
}

/** The latest known state and sensor values for one purifier. */
export class Snapshot {
  state: Fields = {};
  sensor: Fields = {};

  /** Fold in one message; return its type if it carried state or sensor data. */
  apply(payload: unknown): string | null {
    if (!isFields(payload)) return null;
    const msg = payload.msg;
    if (msg === CURRENT_STATE || msg === STATE_CHANGE) {
      const fields = payload["product-state"];
      if (!isFields(fields)) return null;
      const values = newestOf(fields);
      this.state = msg === CURRENT_STATE ? values : { ...this.state, ...values };
      return msg;
    }
    if (msg === SENSOR_DATA) {
      const fields = payload.data;
      if (!isFields(fields)) return null;
      this.sensor = newestOf(fields);
      return msg;
    }
    return null;
  }

  reading(serial: string, takenAt: string): Reading {
    const { state, sensor } = this;
    let autoMode = asFlag(state.auto);
    if (autoMode === null && String(state.fnsp ?? "").toUpperCase() === "AUTO") autoMode = true;
    return {
      serial,
      takenAt,
      power: asFlag(state.fpwr),
      fanSpeed: asInt(state.fnsp),
      autoMode,
      nightMode: asFlag(state.nmod),
      monitoring: asFlag(state.rhtm),
      fanState: asText(state.fnst),
      hepaFilterPct: asInt(state.hflr),
      carbonFilterPct: asInt(state.cflr),
      pm25: asInt(sensor.pm25),
      pm10: asInt(sensor.pm10),
      sensorStatus: sensorStatus(sensor),
      state: { ...state },
      sensor: { ...sensor },
    };
  }
}

function sensorStatus(sensor: Fields): string | null {
  for (const key of ["pm25", "pm10"]) {
    const value = sensor[key];
    if (typeof value !== "string") continue;
    const word = value.trim().toUpperCase();
    if ((SENSOR_STATUSES as readonly string[]).includes(word)) return word;
  }
  return null;
}
