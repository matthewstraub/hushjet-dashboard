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
import { NoteDialog, type NoteDialogState } from "@/components/NoteDialog";
import { NoteList } from "@/components/NoteList";
import { NOTE_LANE, NoteMarkers, TooltipNotes } from "@/components/NoteMarkers";
import { ScrollRegion } from "@/components/ScrollRegion";
import { Button } from "@/components/ui/button";
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
import { SLOT_MS, slotRows, withOutdoor, type SlotRowWithOutdoor } from "@/lib/history";
import { noteOverlaps, notesAt, spanWithNotes } from "@/lib/notes";
import { adminSignInHref } from "@/lib/signIn";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
// Named apart from the Note box below, which shows an empty or error state.
import type { Note as NoteEntry } from "@shared/notes";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Customized, Line, LineChart, XAxis, YAxis } from "recharts";
import { Link } from "wouter";

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

// Indoors is the point and outdoors the context, so outdoors gets the
// de-emphasis gray rather than another series color.
const OUTDOOR_CONFIG = {
  pm25: { label: "Indoors", color: "var(--series-1)" },
  outdoorPoint: { label: "Outdoors", color: "var(--muted-foreground)" },
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

/** The y-axis and right margin, which the plot doesn't use. */
const PLOT_INSET = 36 + 12;
/** How close to a note, in pixels, the pointer brings it into the tooltip. */
const NOTE_REACH_PX = 10;

/** An element's width, kept up to date. */
function useWidth() {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, width] as const;
}

export function HistoryCard() {
  const [range, setRange] = useState<Range>("24h");
  // An open page reloads as often as the server copies Dyson's history.
  const history = trpc.readings.history.useQuery({ range }, { refetchInterval: 10 * 60_000 });
  // Marked on the charts. Adding or changing a note reloads these.
  const notes = trpc.notes.inRange.useQuery({ range }, { refetchInterval: 10 * 60_000 });
  const me = trpc.auth.me.useQuery();
  const canEdit = me.data?.role === "admin";
  const [dialog, setDialog] = useState<NoteDialogState | null>(null);
  const utils = trpc.useUtils();
  // Loading the history copies Dyson's newest slots first, so the status
  // card's "saved history" may have moved on.
  useEffect(() => {
    if (history.dataUpdatedAt) void utils.readings.status.invalidate();
  }, [history.dataUpdatedAt, utils]);
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
    () => withOutdoor(slotRows(history.data?.slots ?? []), history.data?.outdoor ?? []),
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
    body = (
      <HistoryCharts
        slots={slots}
        readings={readings}
        notes={notes.data?.notes ?? []}
        onAddAt={canEdit ? t => setDialog({ mode: "add", startsAt: new Date(t) }) : undefined}
        // The admin role edits a marker's one note straight away; otherwise
        // the pop-up lists what's behind the marker.
        onSelectNotes={picked =>
          setDialog(canEdit && picked.length === 1 ? { mode: "edit", note: picked[0]! } : { mode: "view", notes: picked })
        }
        onEditNote={canEdit ? note => setDialog({ mode: "edit", note }) : undefined}
        signInHref={!canEdit && me.data?.adminEnabled ? adminSignInHref("/") : undefined}
      />
    );
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
      <CardContent>
        {canEdit && history.data?.databaseConfigured && (
          <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button size="sm" variant="outline" onClick={() => setDialog({ mode: "add" })}>
              <Plus aria-hidden />
              Add note
            </Button>
            <p className="text-xs text-muted-foreground pointer-coarse:hidden">
              Or click a chart at the time it happened. Click a marker to open its note.
            </p>
            <p className="hidden text-xs text-muted-foreground pointer-coarse:block">
              Tap a marker on a chart to open its note.
            </p>
          </div>
        )}
        {body}
      </CardContent>
      <NoteDialog state={dialog} canEdit={canEdit} onClose={() => setDialog(null)} />
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
  notes = [],
  onAddAt,
  onSelectNotes,
  onEditNote,
  signInHref,
}: {
  slots: SlotRowWithOutdoor[];
  readings: ReadingRow[];
  /** Marked on the PM, outdoor and fan charts, and listed under them. */
  notes?: NoteEntry[];
  /** Clicking a chart adds a note at that time. */
  onAddAt?: (t: number) => void;
  /** Clicking a marker opens the notes behind it. */
  onSelectNotes?: (notes: NoteEntry[]) => void;
  /** Adds an Edit button to each listed note. */
  onEditNote?: (note: NoteEntry) => void;
  /** For a viewer, where to sign in as admin to add notes. */
  signInHref?: string;
}) {
  // Dyson's averages cover every 15 minutes; readings are only as often as
  // the sync runs, so they stand in for PM only until there's Dyson history.
  // Real 15-minute slots, not rows that only hold an outdoor point.
  const pmFromSlots = slots.some(row => !row.gap);
  // One time span for every chart, so they line up. Both lists are oldest first.
  const ends = [
    slots[0]?.t,
    readings[0]?.t,
    slots.at(-1)?.t,
    readings.at(-1)?.t,
  ].filter((t): t is number => t !== undefined);
  // Stretched to take in a note made since the newest slot started.
  const span = spanWithNotes([Math.min(...ends), Math.max(...ends)], notes, Date.now());
  const hasOutdoor = slots.some(row => row.outdoorPoint !== null);
  const shownNotes = notes.filter(note => noteOverlaps(note, span));
  const marks = { notes: shownNotes, onAddAt, onSelectNotes };
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
          {...marks}
        />
        {hasOutdoor && (
          <TimeChart
            className="lg:col-span-2"
            title="PM2.5 indoors and outdoors, µg/m³"
            config={OUTDOOR_CONFIG}
            data={slots}
            span={span}
            sampled={["outdoorPoint"]}
            note="Each gray dot is an hour of Dyson's outdoor estimate that was saved. The dashed line joins them across hours that weren't."
            slotted
            {...marks}
          />
        )}
        {pmFromSlots ? (
          <TimeChart
            title="Fan speed, 15-minute average"
            config={FAN_CONFIG}
            data={slots}
            span={span}
            yDomain={[0, 10]}
            yTicks={[0, 2, 4, 6, 8, 10]}
            slotted
            {...marks}
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
            // No notes here, but the same top as the fan chart beside it.
            lane={pmFromSlots && shownNotes.length > 0}
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
      <NotesInRange notes={shownNotes} onEdit={onEditNote} signInHref={signInHref} />
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
  sampled,
  note,
  notes = [],
  lane = notes.length > 0,
  onAddAt,
  onSelectNotes,
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
  /** Series saved now and then: a dot per value, joined by a dashed line across the gaps. */
  sampled?: string[];
  /** A line under the chart. */
  note?: string;
  /** Notes to mark, all of them in the span. */
  notes?: NoteEntry[];
  /** Room above the plot for the notes' chips; on whenever there are notes. */
  lane?: boolean;
  /** Clicking the chart with a mouse or pen adds a note at that time. */
  onAddAt?: (t: number) => void;
  /** Clicking a marker opens the notes behind it. */
  onSelectNotes?: (notes: NoteEntry[]) => void;
  className?: string;
}) {
  const keys = Object.keys(config);
  const xAxis = timeAxis(...span);
  const [measure, width] = useWidth();
  // Pointing within a few pixels of a note shows it in the tooltip, at any range.
  const reach = Math.max(SLOT_MS / 2, ((span[1] - span[0]) * NOTE_REACH_PX) / Math.max(1, width - PLOT_INSET));
  // A tap shows the tooltip, so only a mouse or pen click adds a note.
  const pointer = useRef("mouse");
  const [finePointer] = useState(() => window.matchMedia("(pointer: fine)").matches);
  const clickToAdd = Boolean(onAddAt) && finePointer;
  return (
    <figure
      ref={measure}
      onPointerDown={event => {
        pointer.current = event.pointerType;
      }}
      className={cn("space-y-3", className)}
    >
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-medium">{title}</span>
        {/* The legend, for two or more series or with notes: a line key each, labels in text color. */}
        {(keys.length > 1 || notes.length > 0) && (
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {keys.map(key => (
              <span key={key} className="flex items-center gap-1.5">
                {sampled?.includes(key) ? (
                  <span
                    aria-hidden
                    className="w-3 border-t-2 border-dashed"
                    style={{ borderColor: config[key]?.color }}
                  />
                ) : (
                  <span
                    aria-hidden
                    className="h-0.5 w-3 rounded-full"
                    style={{ backgroundColor: config[key]?.color }}
                  />
                )}
                {config[key]?.label}
              </span>
            ))}
            {notes.length > 0 && (
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-3 border-l border-dashed border-foreground/60" />
                Notes
              </span>
            )}
          </span>
        )}
      </figcaption>
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        <LineChart
          data={data}
          // Notes get a strip above the plot for their chips.
          margin={{ top: lane ? 8 + NOTE_LANE : 8, right: 12, bottom: 0, left: 0 }}
          onClick={
            onAddAt &&
            (state => {
              // Outside the plot there's no time to add a note at.
              const t = Number(state?.activeLabel);
              if (pointer.current !== "touch" && Number.isFinite(t)) onAddAt(t);
            })
          }
          style={onAddAt ? { cursor: "pointer" } : undefined}
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
            content={({ active, label, payload }) => {
              const near = notes.length ? notesAt(notes, Number(payload?.[0]?.payload?.t), reach) : [];
              return (
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
                  footer={
                    (near.length > 0 || clickToAdd) && (
                      <>
                        <TooltipNotes notes={near} />
                        {clickToAdd && (
                          <p className={cn("text-muted-foreground", near.length === 0 && "border-t border-border/50 pt-1.5")}>
                            Click to add a note here
                          </p>
                        )}
                      </>
                    )
                  }
                />
              );
            }}
          />
          {/* Under the lines, so the data stays on top. */}
          {notes.length > 0 && (
            <Customized component={<NoteMarkers notes={notes} span={span} onSelect={onSelectNotes} />} />
          )}
          {/* Drawn last to first, so where the series meet, as PM2.5 and PM10
              often do, the first is the one on top. */}
          {[...keys].reverse().map(key => {
            const isSampled = sampled?.includes(key) ?? false;
            return (
              <Line
                key={key}
                dataKey={key}
                type="linear"
                stroke={`var(--color-${key})`}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                // Sampled series: an 8px dot with a surface ring per value, joined across gaps.
                strokeDasharray={isSampled ? "4 4" : undefined}
                connectNulls={isSampled}
                // The dots would otherwise inherit the line's dashes.
                dot={
                  isSampled
                    ? { r: 4, fill: `var(--color-${key})`, stroke: "var(--card)", strokeWidth: 2, strokeDasharray: "0" }
                    : false
                }
                activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ChartContainer>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </figure>
  );
}

const LINK =
  "rounded-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** The notes on the charts, newest first, with a link to every note. */
function NotesInRange({
  notes,
  onEdit,
  signInHref,
}: {
  notes: NoteEntry[];
  onEdit?: (note: NoteEntry) => void;
  signInHref?: string;
}) {
  return (
    <section aria-labelledby="notes-in-range" className="space-y-3 border-t border-border pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="notes-in-range" className="text-sm font-medium">
          Notes in this range
          {notes.length > 0 && <span className="font-normal text-muted-foreground"> · {notes.length}</span>}
        </h3>
        <Link href="/notes" className={cn(LINK, "text-xs text-muted-foreground")}>
          All notes
        </Link>
      </div>
      {notes.length > 0 ? (
        <NoteList notes={[...notes].reverse()} onEdit={onEdit} headingLevel={4} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {onEdit
            ? "None yet. Add one when you cook, clean, open the windows, or the heat or air conditioning comes on, and it's marked on the charts."
            : "None in this range."}
        </p>
      )}
      {signInHref && (
        <p className="text-xs">
          <a href={signInHref} className={cn(LINK, "text-muted-foreground")}>
            Sign in as admin to add notes
          </a>
        </p>
      )}
    </section>
  );
}

const TH = "py-1 pr-4 font-normal";
const TD = "py-1 pr-4";

/** Dyson's slots as a table, for screen readers and exact values. */
function SlotsTable({ rows }: { rows: SlotRowWithOutdoor[] }) {
  const latest = rows
    .filter(row => !row.gap)
    .slice(-50)
    .reverse();
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        Show the latest {latest.length} 15-minute averages as a table
      </summary>
      <ScrollRegion label="15-minute averages" className="mt-3">
        <table className="w-full text-left tabular-nums">
          <thead className="text-muted-foreground">
            <tr>
              <th className={TH}>Time</th>
              <th className={TH}>PM2.5</th>
              <th className={TH}>PM10</th>
              <th className={TH}>Outdoors</th>
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
                <td className={TD}>{numberText(row.outdoor)}</td>
                <td className={TD}>{numberText(row.fan)}</td>
                <td className={cn(TD, "pr-0")}>
                  {minutesText(row.ranMinutes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
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
      <ScrollRegion label="Stored readings" className="mt-3">
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
      </ScrollRegion>
    </details>
  );
}
