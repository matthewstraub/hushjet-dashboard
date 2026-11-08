import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { clockTime, dayLabel, durationText, numberText } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { TriangleAlert } from "lucide-react";
import { useMemo } from "react";

const DAYS = 7;
/** A full day has 96 slots (92 or 100 when the clocks change); fewer means data is missing. */
const FULL_DAY_SLOTS = 92;

const TH = "py-2 pr-4 font-normal whitespace-nowrap";
const TD = "py-2 pr-4 whitespace-nowrap";

/** One row per day: what the air was like, and what the fan did about it. */
export function DailyCard() {
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const daily = trpc.readings.daily.useQuery({ timeZone, days: DAYS });

  let body;
  if (daily.isLoading) {
    body = <Skeleton className="h-40 w-full" />;
  } else if (daily.error) {
    body = <Note>{`Couldn't load the summaries: ${daily.error.message}`}</Note>;
  } else if (!daily.data?.databaseConfigured) {
    body = <Note>Daily summaries need a database, like the history.</Note>;
  } else if (daily.data.summaries.length === 0) {
    body = <Note>No 15-minute history in the last {DAYS} days yet.</Note>;
  } else {
    const { guideline, spike } = daily.data.thresholds;
    body = (
      <>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className={TH}>Day</th>
                <th scope="col" className={TH}>Avg PM2.5</th>
                <th scope="col" className={TH}>Peak</th>
                <th scope="col" className={TH}>Over {guideline}</th>
                <th scope="col" className={TH}>Spike cleared in</th>
                <th scope="col" className={TH}>Avg fan speed</th>
                <th scope="col" className={`${TH} pr-0`}>Fan ran</th>
              </tr>
            </thead>
            <tbody>
              {daily.data.summaries.map(day => (
                <tr key={day.date} className="border-t border-border">
                  <th scope="row" className={`${TD} font-medium`}>
                    {dayLabel(day.date, day.today)}
                    {(day.today || day.slots < FULL_DAY_SLOTS) && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        {day.today ? "so far" : "partial"}
                      </span>
                    )}
                  </th>
                  <td className={TD}>
                    <span className="inline-flex items-center gap-1">
                      {numberText(day.avgPm25)}
                      {day.aboveGuideline && (
                        <>
                          <TriangleAlert className="size-3.5 text-status-warning" aria-hidden />
                          <span className="sr-only">, above the WHO guideline</span>
                        </>
                      )}
                    </span>
                  </td>
                  <td className={TD}>
                    {day.peakPm25 === null || !day.peakAt
                      ? "–"
                      : `${numberText(day.peakPm25)} at ${clockTime(day.peakAt)}`}
                  </td>
                  <td className={TD}>
                    {day.minutesAbove === null ? "–" : day.minutesAbove ? durationText(day.minutesAbove) : "None"}
                  </td>
                  <td className={TD}>
                    {!day.spike
                      ? "–"
                      : day.spike.clearedMinutes === null
                        ? "Not yet"
                        : durationText(day.spike.clearedMinutes)}
                  </td>
                  <td className={TD}>{numberText(day.avgFanSpeed)}</td>
                  <td className={`${TD} pr-0`}>{day.fanHours === null ? "–" : `${day.fanHours} h`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          PM2.5 in µg/m³, from Dyson's 15-minute averages, by day in your time zone. {guideline} is
          the WHO's guideline for a 24-hour average; a warning sign marks a day above it. A spike is
          a 15-minute average of {spike} or more; it's cleared when the average is back under{" "}
          {guideline}. Partial days are missing some data, like the day the purifier was set up.
        </p>
      </>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily summary</CardTitle>
        <CardDescription>The last {DAYS} days</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
