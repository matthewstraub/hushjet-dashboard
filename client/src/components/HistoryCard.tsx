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
import {
  fullTime,
  minutesText,
  numberText,
  percentText,
  pmText,
  slotTime,
  timeAxis,
  type Range,
} from "@/lib/format";
import { slotRows, type SlotRow } from "@/lib/history";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

// Short labels, so the tabs leave room for the title on a phone.
const RANGES: { value: Range; label: string; name: string }[] = [
  { value: "24h", label: "24h", name: "Last 24 hours" },
  { value: "7d", label: "7d", name: "Last 7 days" },
  { value: "30d", label: "30d", name: "Last 30 days" },
];

// Fixed order in every chart: the first series is --series-1, the second --series-2.
const PM_CONFIG = {
  pm25: { label: "PM2.5", color: "var(--series-1)" },
  pm10: { label: "PM10", color: "var(--series-2)" },
} satisfies ChartConfig;

const FAN_CONFIG = {
  fan: { label: "Fan speed", color: "var(--series-1)" },
} satisfies ChartConfig;

const FILTER_CONFIG = {
  hepa: { label: "HEPA", color: "var(--series-1)" },
  carbon: { label: "Carbon", color: "var(--series-2)" },
} satisfies ChartConfig;

/** One stored reading, for filter life and, before there's Dyson history, PM. */
export interface ReadingRow {
  t: number;
  pm25: number | null;
  pm10: number | null;
  hepa: number | null;
  carbon: number | null;
}

/** A chart row: a time, and a value under each key in the chart's config. */
type Row = { t: number };

export function HistoryCard() {
  const [range, setRange] = useState<Range>("24h");
  const history = trpc.readings.history.useQuery({ range });
  const readings = useMemo<ReadingRow[]>(
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
  const slots = useMemo(
    () => slotRows(history.data?.slots ?? []),
    [history.data]
  );

  let body;
  if (history.isLoading) {
    body = <Skeleton className="h-56 w-full" />;
  } else if (history.error) {
    body = (
      <Note title="Couldn't load the history">{history.error.message}</Note>
    );
  } else if (!history.data?.databaseConfigured) {
    body = (
      <Note title="History needs a database">
        Set <code>DATABASE_URL</code> (TiDB, at deploy time). Dyson's 15-minute
        history and every reading are then stored and charted here.
      </Note>
    );
  } else if (readings.length === 0 && slots.length === 0) {
    body = (
      <Note title="No stored history in this range yet">
        It's copied from Dyson's cloud as <code>pnpm sync</code> runs and as
        this page loads.
      </Note>
    );
  } else {
    body = <HistoryCharts slots={slots} readings={readings} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
        <CardDescription>
          15-minute averages from Dyson, and filter life from readings
        </CardDescription>
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

function Note({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-border px-4 py-8 text-center",
        className
      )}
    >
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

export function HistoryCharts({
  slots,
  readings,
}: {
  slots: SlotRow[];
  readings: ReadingRow[];
}) {
  // Dyson's averages cover every 15 minutes; readings are only as often as
  // the sync runs, so they stand in for PM only until there's Dyson history.
  const pmFromSlots = slots.length > 0;
  // One time span for every chart, so they line up. Both lists are oldest first.
  const ends = [
    slots[0]?.t,
    readings[0]?.t,
    slots.at(-1)?.t,
    readings.at(-1)?.t,
  ].filter((t): t is number => t !== undefined);
  const span: [number, number] = [Math.min(...ends), Math.max(...ends)];
  return (
    <div className="space-y-6">
      <div className="grid gap-8 lg:grid-cols-2">
        <TimeChart
          className="lg:col-span-2"
          title={
            pmFromSlots
              ? "PM2.5 and PM10, µg/m³, 15-minute averages"
              : "PM2.5 and PM10, µg/m³"
          }
          config={PM_CONFIG}
          data={pmFromSlots ? slots : readings}
          span={span}
          slotted={pmFromSlots}
        />
        {pmFromSlots ? (
          <TimeChart
            title="Fan speed, 15-minute average"
            config={FAN_CONFIG}
            data={slots}
            span={span}
            yDomain={[0, 10]}
            yTicks={[0, 2, 4, 6, 8, 10]}
            slotted
          />
        ) : (
          <Note title="No fan history in this range" className="self-center">
            It comes from Dyson's 15-minute history.
          </Note>
        )}
        {readings.length > 0 ? (
          <TimeChart
            title="Filter life, %"
            config={FILTER_CONFIG}
            data={readings}
            span={span}
            yDomain={[0, 100]}
            yTicks={[0, 25, 50, 75, 100]}
          />
        ) : (
          <Note
            title="No filter readings in this range"
            className="self-center"
          >
            Filter life comes from readings, which <code>pnpm sync</code> and
            this page store.
          </Note>
        )}
      </div>
      <div className="space-y-3">
        {pmFromSlots && <SlotsTable rows={slots} />}
        {readings.length > 0 && <ReadingsTable rows={readings} />}
      </div>
    </div>
  );
}

function TimeChart({
  title,
  config,
  data,
  span,
  yDomain,
  yTicks,
  slotted = false,
  className,
}: {
  title: string;
  config: ChartConfig;
  data: Row[];
  /** The first and last times on the x-axis. */
  span: [number, number];
  yDomain?: [number, number];
  yTicks?: number[];
  /** Each row is a 15-minute slot, so the tooltip shows the span it covers. */
  slotted?: boolean;
  className?: string;
}) {
  const keys = Object.keys(config);
  const xAxis = timeAxis(...span);
  return (
    <figure className={cn("space-y-3", className)}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-medium">{title}</span>
        {/* The legend, for two or more series: a line key each, labels in text color. */}
        {keys.length > 1 && (
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
        )}
      </figcaption>
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        <LineChart
          data={data}
          margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={span}
            ticks={xAxis.ticks.length ? xAxis.ticks : undefined}
            tickFormatter={(ms: number) => xAxis.format(ms)}
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
            ticks={yTicks}
          />
          <ChartTooltip
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            content={({ active, label, payload }) => (
              <ChartTooltipContent
                active={active}
                label={label}
                // In legend order, though the lines are drawn in reverse.
                payload={[...(payload ?? [])].sort(
                  (a, b) =>
                    keys.indexOf(String(a.dataKey)) -
                    keys.indexOf(String(b.dataKey))
                )}
                indicator="line"
                labelFormatter={(_, items) => {
                  const t = Number(items?.[0]?.payload?.t);
                  return slotted ? slotTime(t) : fullTime(t);
                }}
              />
            )}
          />
          {/* Drawn last to first, so where the series meet, as PM2.5 and PM10
              often do, the first is the one on top. */}
          {[...keys].reverse().map(key => (
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

const TH = "py-1 pr-4 font-normal";
const TD = "py-1 pr-4";

/** Dyson's slots as a table, for screen readers and exact values. */
function SlotsTable({ rows }: { rows: SlotRow[] }) {
  const latest = rows
    .filter(row => !row.gap)
    .slice(-50)
    .reverse();
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        Show the latest {latest.length} 15-minute averages as a table
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left tabular-nums">
          <thead className="text-muted-foreground">
            <tr>
              <th className={TH}>Time</th>
              <th className={TH}>PM2.5</th>
              <th className={TH}>PM10</th>
              <th className={TH}>Fan speed</th>
              <th className={cn(TH, "pr-0")}>Fan ran</th>
            </tr>
          </thead>
          <tbody>
            {latest.map(row => (
              <tr key={row.t} className="border-t border-border">
                <td className={TD}>{slotTime(row.t)}</td>
                <td className={TD}>{numberText(row.pm25)}</td>
                <td className={TD}>{numberText(row.pm10)}</td>
                <td className={TD}>{numberText(row.fan)}</td>
                <td className={cn(TD, "pr-0")}>
                  {minutesText(row.ranMinutes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** The stored readings as a table. */
function ReadingsTable({ rows }: { rows: ReadingRow[] }) {
  const latest = rows.slice(-50).reverse();
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        Show the latest {latest.length} readings as a table
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left tabular-nums">
          <thead className="text-muted-foreground">
            <tr>
              <th className={TH}>Time</th>
              <th className={TH}>PM2.5</th>
              <th className={TH}>PM10</th>
              <th className={TH}>HEPA</th>
              <th className={cn(TH, "pr-0")}>Carbon</th>
            </tr>
          </thead>
          <tbody>
            {latest.map(row => (
              <tr key={row.t} className="border-t border-border">
                <td className={TD}>{fullTime(row.t)}</td>
                <td className={TD}>{pmText(row.pm25, null)}</td>
                <td className={TD}>{pmText(row.pm10, null)}</td>
                <td className={TD}>{percentText(row.hepa)}</td>
                <td className={cn(TD, "pr-0")}>{percentText(row.carbon)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
