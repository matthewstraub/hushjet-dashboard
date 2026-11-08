/** Words for the purifier's schedule; see server/dyson/schedule.ts. */

export interface ScheduleSettings {
  fan: "auto" | number | null;
  nightMode: boolean | null;
  power: boolean | null;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Shown Monday first.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** "22:05" -> "10:05 PM". */
export function clockText(time: string): string {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const suffix = hours < 12 ? "AM" : "PM";
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/** "Every day", "Weekdays", "Weekends", or "Mon, Wed, Fri" (0 is Sunday). */
export function daysText(days: number[]): string {
  const set = new Set(days);
  const has = (list: number[]) => list.every(day => set.has(day)) && set.size === list.length;
  if (has([0, 1, 2, 3, 4, 5, 6])) return "Every day";
  if (has([1, 2, 3, 4, 5])) return "Weekdays";
  if (has([0, 6])) return "Weekends";
  return WEEK_ORDER.filter(day => set.has(day)).map(day => DAY_NAMES[day]).join(", ") || "No days";
}

/** "Auto · Night mode on", "Speed 4", "Power off". */
export function settingsText(settings: ScheduleSettings): string {
  const parts: string[] = [];
  if (settings.power === false) parts.push("Power off");
  if (settings.fan === "auto") parts.push("Auto");
  else if (typeof settings.fan === "number") parts.push(`Speed ${settings.fan}`);
  if (settings.nightMode !== null) parts.push(`Night mode ${settings.nightMode ? "on" : "off"}`);
  if (settings.power === true && !parts.length) parts.push("Power on");
  return parts.join(" · ") || "No changes";
}
