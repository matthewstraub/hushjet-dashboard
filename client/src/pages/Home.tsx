import { DailyCard } from "@/components/DailyCard";
import { HistoryCard } from "@/components/HistoryCard";
import { SiteHeader } from "@/components/SiteHeader";
import { AirComparisonCard } from "@/components/AirComparisonCard";
import { StatusCard } from "@/components/StatusCard";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { clockTime, fanText, onOffText, percentText, pmText } from "@/lib/format";
import { latestFailure } from "@/lib/status";
import { trpc } from "@/lib/trpc";
import {
  Activity,
  AlertTriangle,
  Fan,
  Filter,
  Moon,
  RefreshCw,
  Wind,
  type LucideIcon,
} from "lucide-react";

export default function Home() {
  const utils = trpc.useUtils();
  const live = trpc.readings.live.useQuery(undefined, {
    // The server reuses a reading for a minute; this keeps an open tab current.
    refetchInterval: 2 * 60_000,
    staleTime: 60_000,
    retry: false,
  });
  const refresh = trpc.readings.refresh.useMutation({
    onSuccess: data => {
      utils.readings.live.setData(undefined, data);
      void utils.readings.history.invalidate();
      void utils.readings.daily.invalidate();
    },
  });

  const reading = live.data?.reading;
  const device = live.data?.device;
  // The status card follows the newest read, even when it failed in the
  // background and the last good reading stays on screen. The banner is for
  // a failed Refresh, or when there's no reading to show at all.
  const latestError = latestFailure({
    dataAt: live.dataUpdatedAt,
    queryError: live.error,
    queryErrorAt: live.errorUpdatedAt,
    refreshError: refresh.error,
    refreshAt: refresh.submittedAt,
  });
  const error = reading ? (latestError === refresh.error ? refresh.error : null) : latestError;
  const busy = live.isFetching || refresh.isPending;
  const loading = live.isLoading;

  const subtitle = device
    ? [device.name, device.firmwareVersion && `firmware ${device.firmwareVersion}`]
        .filter(Boolean)
        .join(" · ")
    : "Air quality and filter life";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader
        subtitle={subtitle}
        actions={
          <>
            {reading && (
              <span className="text-xs text-muted-foreground">
                Updated {clockTime(reading.takenAt)}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={() => refresh.mutate()} disabled={busy}>
              <RefreshCw className={busy ? "animate-spin" : undefined} aria-hidden />
              Refresh
            </Button>
          </>
        }
      />

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        {error && (
          <Card className="border-destructive/50" role="alert">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="size-4 text-destructive" aria-hidden />
                Couldn't read the purifier
              </CardTitle>
              <CardDescription>{error.message}</CardDescription>
            </CardHeader>
          </Card>
        )}

        <section
          aria-label="Latest reading"
          className="grid grid-cols-2 gap-4 md:grid-cols-4"
        >
          <Tile label="PM2.5" icon={Wind} loading={loading} unit="µg/m³">
            {pmText(reading?.pm25, reading?.sensorStatus)}
          </Tile>
          <Tile label="PM10" icon={Wind} loading={loading} unit="µg/m³">
            {pmText(reading?.pm10, reading?.sensorStatus)}
          </Tile>
          <Tile
            label="HEPA filter"
            icon={Filter}
            loading={loading}
            unit="life left"
            meter={reading?.hepaFilterPct}
          >
            {percentText(reading?.hepaFilterPct)}
          </Tile>
          <Tile
            label="Carbon filter"
            icon={Filter}
            loading={loading}
            unit="life left"
            meter={reading?.carbonFilterPct}
          >
            {percentText(reading?.carbonFilterPct)}
          </Tile>
        </section>

        {reading && (
          <Card>
            <CardContent className="space-y-3">
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                <Status icon={Fan} label="Fan" value={fanText(reading)} />
                <Status icon={Moon} label="Night mode" value={onOffText(reading.nightMode)} />
                <Status
                  icon={Activity}
                  label="Continuous monitoring"
                  value={onOffText(reading.monitoring)}
                />
              </dl>
              {reading.monitoring === false && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="size-3.5" aria-hidden />
                  Continuous monitoring is off, so PM is only measured while the fan runs. Turn
                  it on in the MyDyson app.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <AirComparisonCard indoor={reading} />

        <StatusCard
          loading={loading}
          reading={reading}
          device={device}
          error={latestError && { message: latestError.message, code: latestError.data?.code }}
        />

        <HistoryCard />

        <DailyCard />
      </main>
    </div>
  );
}

function Tile({
  label,
  icon: Icon,
  unit,
  loading,
  meter,
  children,
}: {
  label: string;
  icon: LucideIcon;
  unit: string;
  loading: boolean;
  meter?: number | null;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon className="size-4" aria-hidden />
          {label}
        </CardDescription>
        {loading ? (
          <Skeleton className="h-9 w-16" />
        ) : (
          <CardTitle className="text-3xl tabular-nums">{children}</CardTitle>
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-muted-foreground">
        {meter !== undefined && (
          <Progress value={meter ?? 0} aria-label={`${label} life left`} />
        )}
        <p>{unit}</p>
      </CardContent>
    </Card>
  );
}

function Status({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="ml-auto font-medium sm:ml-0">{value}</dd>
    </div>
  );
}
