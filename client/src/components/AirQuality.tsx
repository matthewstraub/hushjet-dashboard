import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  airQuality,
  BAND_LIMITS,
  bandColor,
  BANDS,
  bandStops,
  POLLUTANT_LABELS,
  type Band,
  type Pollutant,
} from "@/lib/airQuality";
import { cn } from "@/lib/utils";
import { Gauge } from "lucide-react";
import { Link } from "wouter";

/**
 * A band's color as a dot. It sits beside the band's name or a reading,
 * never alone; the faint outline keeps light yellow visible on white.
 */
export function BandDot({ band, className }: { band: Band; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0 rounded-full ring-1 ring-black/15 ring-inset dark:ring-0", className)}
      style={{ backgroundColor: bandColor(band) }}
    />
  );
}

/** A band's dot and name, like "● Good". The name wears text color, not the band's. */
export function BandLabel({ band, className }: { band: Band; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <BandDot band={band} />
      {band.label}
    </span>
  );
}

/**
 * The scale's six bands as one bar, as in the MyDyson app, with a marker at
 * `score` (0 to 6, as scaleScore gives it). The band's name is shown beside
 * it, so the bar itself is hidden from screen readers.
 */
export function AirQualityBar({ score, band, labels = false }: { score?: number; band?: Band; labels?: boolean }) {
  const at = score === undefined ? null : (score / BANDS.length) * 100;
  return (
    <div aria-hidden>
      <div className="relative">
        {/* Equal segments with a 2px gap; the reading's place within its band sets the marker. */}
        <div className="flex h-1.5 gap-0.5">
          {BANDS.map((each, index) => (
            <span
              key={each.id}
              className={cn("flex-1", index === 0 && "rounded-l-full", index === BANDS.length - 1 && "rounded-r-full")}
              style={{ backgroundColor: bandColor(each) }}
            />
          ))}
        </div>
        {at !== null && band && (
          <span
            className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card shadow-[0_0_0_1px_var(--foreground)]"
            // Kept on the bar at either end.
            style={{ left: `clamp(0.4375rem, ${at}%, calc(100% - 0.4375rem))`, backgroundColor: bandColor(band) }}
          />
        )}
      </div>
      {labels && (
        <div className="mt-2 hidden grid-cols-6 gap-0.5 text-center text-xs text-muted-foreground sm:grid">
          {BANDS.map(each => (
            <span key={each.id}>{each.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The air quality now, as the MyDyson app sums it up: the worse of PM2.5
 * and PM10 on their scales, which one that is, and where it sits on the bar.
 */
export function AirQualityCard({
  pm25,
  pm10,
  loading,
}: {
  pm25?: number | null;
  pm10?: number | null;
  loading: boolean;
}) {
  const quality = airQuality(pm25, pm10);
  return (
    <Card>
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Gauge className="size-4" aria-hidden />
          Air quality
        </CardDescription>
        {loading ? (
          <Skeleton className="h-8 w-28" />
        ) : (
          <CardTitle className="flex items-center gap-2.5 text-3xl font-light">
            {quality ? (
              <>
                <BandDot band={quality.band} className="size-3.5" />
                {quality.band.label}
              </>
            ) : (
              "–"
            )}
          </CardTitle>
        )}
        <CardAction>
          <Link
            href="/info#air-quality-scale"
            className="rounded-sm text-xs text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            About the scale
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Skeleton className="h-5 w-32" />
        ) : (
          <p className="text-sm text-muted-foreground">
            {quality
              ? `Dominant: ${POLLUTANT_LABELS[quality.dominant]}`
              : "The sensor isn't giving readings right now."}
          </p>
        )}
        <AirQualityBar score={quality?.score} band={quality?.band} labels />
      </CardContent>
    </Card>
  );
}

/**
 * A legend key for a line drawn in its bands' colors: a short line in the
 * first three, since the line's color changes along it.
 */
export function BandLineKey() {
  return (
    <span aria-hidden className="flex h-0.5 w-4 overflow-hidden rounded-full">
      {BANDS.slice(0, 3).map(band => (
        <span key={band.id} className="flex-1" style={{ backgroundColor: bandColor(band) }} />
      ))}
    </span>
  );
}

/** What Recharts' <Customized> passes in about the chart's y-axis and plot. */
interface YAxisState {
  yAxisMap?: Record<string, { scale: ((value: number) => number) & { domain(): number[] } }>;
  offset?: { left: number };
}

/**
 * The air quality bands beside a PM chart's y-axis, as in the MyDyson app: a
 * thin strip colored by band for the levels the chart shows, between the
 * axis labels and the plot. Drawn through Recharts' <Customized>, which
 * passes in the axis. On most days it's all Good, since the axis stops just
 * above the highest reading.
 */
export function BandStrip({ pollutant, yAxisMap, offset }: { pollutant: Pollutant } & YAxisState) {
  const axis = yAxisMap ? Object.values(yAxisMap)[0] : undefined;
  if (!axis || !offset) return null;
  const [low = 0, high = 0] = axis.scale.domain();
  const limits = BAND_LIMITS[pollutant];
  return (
    <g aria-hidden>
      {BANDS.map((band, index) => {
        const from = index === 0 ? 0 : limits[index - 1]!;
        const to = limits[index] ?? Infinity;
        if (from >= high || to <= low) return null;
        // A 1px gap at each end, so neighboring bands sit 2px apart.
        const top = axis.scale(Math.min(to, high)) + 1;
        const bottom = axis.scale(Math.max(from, low)) - 1;
        return (
          <rect
            key={band.id}
            x={offset.left - 6}
            y={top}
            width={3}
            height={Math.max(0, bottom - top)}
            rx={1.5}
            fill={bandColor(band)}
          />
        );
      })}
    </g>
  );
}

/**
 * Paints a PM line in the colors of the bands it passes through, as the
 * MyDyson app does: a gradient down the y-axis that steps to the next band's
 * color at each limit, so the line changes color where it crosses one. A line
 * uses it with a stroke of `url(#id)`. Drawn through Recharts' <Customized>,
 * which passes in the axis. It's laid out in the chart's own coordinates,
 * since in a line's bounding box a flat line wouldn't be drawn at all.
 */
export function BandGradient({ id, pollutant, yAxisMap }: { id: string; pollutant: Pollutant } & YAxisState) {
  const axis = yAxisMap ? Object.values(yAxisMap)[0] : undefined;
  if (!axis) return null;
  const [low = 0, high = 0] = axis.scale.domain();
  return (
    <defs>
      <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={axis.scale(high)} y2={axis.scale(low)}>
        {bandStops(pollutant, low, high).map((stop, index) => (
          <stop key={index} offset={stop.offset} style={{ stopColor: bandColor(stop.band) }} />
        ))}
      </linearGradient>
    </defs>
  );
}
