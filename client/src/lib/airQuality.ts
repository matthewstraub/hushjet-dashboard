/**
 * The MyDyson app's air quality scale: six bands, Good to Severe, each with
 * its own color, for PM2.5 and PM10 separately. The limits are the ones the
 * app shows, as documented by the hass-dyson and DysonBar projects; the
 * colors are tokens in index.css.
 */

export type Pollutant = "pm25" | "pm10";

export interface Band {
  id: "good" | "fair" | "poor" | "very-poor" | "extremely-poor" | "severe";
  label: string;
  /** What the band means, and what helps. */
  meaning: string;
}

export const BANDS: readonly Band[] = [
  { id: "good", label: "Good", meaning: "Very few particles in the air." },
  { id: "fair", label: "Fair", meaning: "Some particles. A low fan speed, or Auto, clears them." },
  {
    id: "poor",
    label: "Poor",
    meaning: "A lot of particles, as from cooking or candles. A medium fan speed, or Auto, clears them.",
  },
  { id: "very-poor", label: "Very poor", meaning: "A high level of particles. A high fan speed, or Auto, clears them." },
  {
    id: "extremely-poor",
    label: "Extremely poor",
    meaning: "A very high level. Run a high fan speed, or Auto, and look for the source.",
  },
  {
    id: "severe",
    label: "Severe",
    meaning:
      "The top of the scale. Run a high fan speed, or Auto, find the source, and open a window if the air outside is better.",
  },
];

/** The top of each band below Severe, in µg/m³. A value on a limit is in the lower band. */
export const BAND_LIMITS: Record<Pollutant, readonly number[]> = {
  pm25: [35, 53, 70, 150, 250],
  pm10: [50, 75, 100, 350, 420],
};

export const POLLUTANT_LABELS: Record<Pollutant, string> = { pm25: "PM2.5", pm10: "PM10" };

type Maybe = number | null | undefined;

/** The band a reading is in, or null without a reading. */
export function bandFor(pollutant: Pollutant, value: Maybe): Band | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const index = BAND_LIMITS[pollutant].findIndex(limit => value <= limit);
  return BANDS[index === -1 ? BANDS.length - 1 : index]!;
}

/**
 * Where a reading sits along the scale, from 0 to 6: the band's number plus
 * how far into the band it is, so a bar's marker moves smoothly within a
 * band. Severe has no top, so it's drawn as reaching twice its lower limit.
 */
export function scaleScore(pollutant: Pollutant, value: number): number {
  const limits = BAND_LIMITS[pollutant];
  let lower = 0;
  for (let index = 0; index < limits.length; index++) {
    const upper = limits[index]!;
    if (value <= upper) return index + Math.max(0, value - lower) / (upper - lower);
    lower = upper;
  }
  return Math.min(BANDS.length, limits.length + (value - lower) / lower);
}

export interface AirQuality {
  band: Band;
  /** 0 to 6, as scaleScore gives it. */
  score: number;
  /** The pollutant further along its scale, as the MyDyson app's "Dominant". */
  dominant: Pollutant;
}

/** The worse of PM2.5 and PM10 on their scales, or null with neither. */
export function airQuality(pm25: Maybe, pm10: Maybe): AirQuality | null {
  let worst: { pollutant: Pollutant; value: number; score: number } | null = null;
  for (const [pollutant, value] of [["pm25", pm25], ["pm10", pm10]] as const) {
    if (value === null || value === undefined || Number.isNaN(value)) continue;
    const score = scaleScore(pollutant, value);
    // PM2.5 comes first and keeps a tie, as in the app, where clean air shows "Dominant: PM2.5".
    if (!worst || score > worst.score) worst = { pollutant, value, score };
  }
  return worst && { band: bandFor(worst.pollutant, worst.value)!, score: worst.score, dominant: worst.pollutant };
}

/** A band from its name, like Dyson's outdoor "Good", or null for a name the scale doesn't use. */
export function bandNamed(name: string | null | undefined): Band | null {
  const wanted = name?.trim().toLowerCase();
  return BANDS.find(band => band.label.toLowerCase() === wanted) ?? null;
}

/** The band's color token. */
export function bandColor(band: Band): string {
  return `var(--aq-${band.id})`;
}

/** "up to 35" for PM2.5 in Good, "over 250" in Severe. */
export function bandRangeText(pollutant: Pollutant, band: Band): string {
  const index = BANDS.indexOf(band);
  const limits = BAND_LIMITS[pollutant];
  return index < limits.length ? `up to ${limits[index]}` : `over ${limits.at(-1)}`;
}
