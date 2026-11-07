import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { axisTime, fullTime, percentText, pmText, type Range } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

// Short labels, so the tabs leave room for the title on a phone.
const RANGES: { value: Range; label: string; name: string }[] = [
  { value: "24h", label: "24h", name: "Last 24 hours" },
  { value: "7d", label: "7d", name: "Last 7 days" },
  { value: "30d", label: "30d", name: "Last 30 days" },
];

// Fixed order in both charts: the first series is --series-1, the second --series-2.
const PM_CONFIG = {
  pm25: { label: "PM2.5", color: "var(--series-1)" },
  pm10: { label: "PM10", color: "var(--series-2)" },
} satisfies ChartConfig;

const FILTER_CONFIG = {
  hepa: { label: "HEPA", color: "var(--series-1)" },
  carbon: { label: "Carbon", color: "var(--series-2)" },
} satisfies ChartConfig;

export interface Point {
  t: number;
  pm25: number | null;
  pm10: number | null;
  hepa: number | null;
  carbon: number | null;
}

type SeriesKey = Exclude<keyof Point, "t">;

export function HistoryCard() {
  const [range, setRange] = useState<Range>("24h");
  const history = trpc.readings.history.useQuery({ range });
  const points = useMemo<Point[]>(
    () =>
      (history.data?.points ?? []).map(point => ({
        t: new Date(point.takenAt).getTime(),
        pm25: point.pm25,
        pm10: point.pm10,
        hepa: point.hepaFilterPct,
        carbon: point.carbonFilterPct,
      })),
    [history.data]
  );

  let body;
  if (history.isLoading) {
    body = <Skeleton className="h-56 w-full" />;
  } else if (history.error) {
    body = <Note title="Couldn't load the history">{history.error.message}</Note>;
  } else if (!history.data?.databaseConfigured) {
    body = (
      <Note title="History needs a database">
        Set <code>DATABASE_URL</code> (TiDB, at deploy time). Every reading from{" "}
        <code>pnpm sync</code> and from this page is then stored and charted here.
      </Note>
    );
  } else if (points.length === 0) {
    body = (
      <Note title="No stored readings in this range yet">
        They appear as <code>pnpm sync</code> runs and as this page reads the purifier.
      </Note>
    );
  } else {
    body = <HistoryCharts points={points} range={range} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
        <CardDescription>PM and filter life from stored readings</CardDescription>
        <CardAction>
          <Tabs value={range} onValueChange={value => setRange(value as Range)}>
            <TabsList>
              {RANGES.map(option => (
                <TabsTrigger key={option.value} value={option.value} aria-label={option.name}>
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </CardAction>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

export function HistoryCharts({ points, range }: { points: Point[]; range: Range }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-8 lg:grid-cols-2">
        <TimeChart title="PM2.5 and PM10, µg/m³" config={PM_CONFIG} points={points} range={range} />
        <TimeChart
          title="Filter life, %"
          config={FILTER_CONFIG}
          points={points}
          range={range}
          yDomain={[0, 100]}
        />
      </div>
      <ReadingsTable points={points} />
    </div>
  );
}

function TimeChart({
  title,
  config,
  points,
  range,
  yDomain,
}: {
  title: string;
  config: ChartConfig;
  points: Point[];
  range: Range;
  yDomain?: [number, number];
}) {
  const keys = Object.keys(config) as SeriesKey[];
  return (
    <figure className="space-y-3">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-medium">{title}</span>
        {/* The legend: a line key per series, labels in text color. */}
        <span className="flex gap-4 text-xs text-muted-foreground">
          {keys.map(key => (
            <span key={key} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-0.5 w-3 rounded-full"
                style={{ backgroundColor: config[key]?.color }}
              />
              {config[key]?.label}
            </span>
          ))}
        </span>
      </figcaption>
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(ms: number) => axisTime(ms, range)}
            tickLine={false}
            axisLine={false}
            minTickGap={40}
          />
          <YAxis
            width={36}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            domain={yDomain ?? [0, "auto"]}
          />
          <ChartTooltip
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            content={
              <ChartTooltipContent
                indicator="line"
                labelFormatter={(_, payload) => fullTime(Number(payload?.[0]?.payload?.t))}
              />
            }
          />
          {keys.map(key => (
            <Line
              key={key}
              dataKey={key}
              type="linear"
              stroke={`var(--color-${key})`}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
    </figure>
  );
}

/** The same readings as a table, for screen readers and exact values. */
function ReadingsTable({ points }: { points: Point[] }) {
  const rows = points.slice(-50).reverse();
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        Show the latest {rows.length} readings as a table
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left tabular-nums">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 pr-4 font-normal">Time</th>
              <th className="py-1 pr-4 font-normal">PM2.5</th>
              <th className="py-1 pr-4 font-normal">PM10</th>
              <th className="py-1 pr-4 font-normal">HEPA</th>
              <th className="py-1 font-normal">Carbon</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(point => (
              <tr key={point.t} className="border-t border-border">
                <td className="py-1 pr-4">{fullTime(point.t)}</td>
                <td className="py-1 pr-4">{pmText(point.pm25, null)}</td>
                <td className="py-1 pr-4">{pmText(point.pm10, null)}</td>
                <td className="py-1 pr-4">{percentText(point.hepa)}</td>
                <td className="py-1">{percentText(point.carbon)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
