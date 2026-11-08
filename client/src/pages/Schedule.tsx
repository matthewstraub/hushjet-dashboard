import { SiteHeader } from "@/components/SiteHeader";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { clockText, daysText, settingsText } from "@/lib/schedule";
import { trpc } from "@/lib/trpc";
import { CircleCheck, CircleMinus } from "lucide-react";

/** The schedule set in the MyDyson app: read here, changed there. */
export default function Schedule() {
  const schedule = trpc.readings.schedule.useQuery(undefined, { retry: false });
  const periods = schedule.data?.periods ?? [];
  const nightAuto = periods.some(period => period.settings.nightMode === true && period.settings.fan === "auto");

  let body;
  if (schedule.isLoading) {
    body = <Skeleton className="h-24 w-full" />;
  } else if (schedule.error) {
    body = <p className="text-sm text-destructive">{`Couldn't load the schedule: ${schedule.error.message}`}</p>;
  } else if (periods.length === 0) {
    body = <p className="text-sm text-muted-foreground">No schedule is set. Add one in the MyDyson app.</p>;
  } else {
    body = (
      <ul className="divide-y divide-border">
        {periods.map((period, index) => (
          <li
            key={`${index}-${period.start}`}
            className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3 first:pt-0 last:pb-0"
          >
            <div>
              <p className="font-medium tabular-nums">
                {period.end
                  ? `${clockText(period.start)} – ${clockText(period.end)}${period.end <= period.start ? " next day" : ""}`
                  : `At ${clockText(period.start)}`}
              </p>
              <p className="text-sm text-muted-foreground">
                {daysText(period.days)}
                {period.repeats ? "" : ", once"}
                {period.enabled ? "" : " · paused"}
              </p>
            </div>
            <p className="text-sm">{settingsText(period.settings)}</p>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader subtitle="The schedule set in the MyDyson app" />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <Card>
          <CardHeader>
            <h2 className="font-semibold leading-none">Schedule</h2>
            <CardDescription>Set in the MyDyson app. Times are in the purifier's time zone.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {schedule.data && (
              <p className="flex items-center gap-2 text-sm">
                {schedule.data.enabled ? (
                  <CircleCheck className="size-4 text-status-good" aria-hidden />
                ) : (
                  <CircleMinus className="size-4 text-muted-foreground" aria-hidden />
                )}
                {schedule.data.enabled ? "Schedule on" : "Schedule off, so none of these periods run"}
              </p>
            )}
            {body}
            {nightAuto && (
              <p className="text-xs text-muted-foreground">
                On this purifier, night mode turns Auto off and holds the fan at speed 4, so a period that
                asks for both runs at speed 4.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Change the schedule in the MyDyson app. Changes there can take up to five minutes to show here.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
