import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { durationText } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { useState } from "react";

/** The parts of a reading the controls show. */
export interface ControlReading {
  power: boolean | null;
  autoMode: boolean | null;
  fanSpeed: number | null;
  nightMode: boolean | null;
  monitoring: boolean | null;
  state: Record<string, unknown>;
}

type Changes = {
  power?: boolean;
  auto?: boolean;
  fanSpeed?: number;
  nightMode?: boolean;
  sleepTimer?: number;
  monitoring?: boolean;
};

const SPEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const TIMERS = [0, 15, 30, 60, 120, 240, 480];

/**
 * The purifier's settings as controls, for admins. Each change goes to the
 * purifier through Dyson's cloud, then the page shows a fresh reading.
 */
export function PurifierControls({ reading }: { reading: ControlReading }) {
  const utils = trpc.useUtils();
  const [note, setNote] = useState<string | null>(null);
  const control = trpc.readings.control.useMutation({
    onSuccess: async data => {
      // A background read that started before the change would bring back the old settings.
      await utils.readings.live.cancel();
      utils.readings.live.setData(undefined, data.live);
      setNote(data.confirmed ? null : "The purifier didn't confirm in time. What's shown is what it reports now.");
    },
  });
  const busy = control.isPending;
  const off = reading.power === false;
  const send = (changes: Changes) => {
    setNote(null);
    control.mutate(changes);
  };

  // "OFF", or the minutes left as "0015".
  const sltm = String(reading.state.sltm ?? "OFF");
  const timerLeft = /^\d+$/.test(sltm) ? Number.parseInt(sltm, 10) : 0;

  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold leading-none">Controls</h2>
        <CardDescription>Changes go to the purifier through Dyson's cloud and take a few seconds.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Toggle label="Power" on={reading.power} disabled={busy} onChange={on => send({ power: on })} />
          <Toggle label="Auto" on={reading.autoMode} disabled={busy || off} onChange={on => send({ auto: on })} />
          <Toggle label="Night mode" on={reading.nightMode} disabled={busy || off} onChange={on => send({ nightMode: on })} />
          <Toggle
            label="Continuous monitoring"
            on={reading.monitoring}
            disabled={busy}
            onChange={on => send({ monitoring: on })}
          />
        </div>

        {reading.nightMode && (
          <p className="text-xs text-muted-foreground">
            On this purifier, night mode turns Auto off and runs the fan at speed 4. Turn Auto back on
            when you want it to choose again.
          </p>
        )}

        <fieldset disabled={busy || off} className="space-y-2">
          <legend className="text-sm text-muted-foreground">
            Fan speed{reading.autoMode ? ": Auto picks it now, or choose one" : ""}
          </legend>
          {/* Two even rows of five on phones, one row on wider screens. */}
          <div className="grid grid-cols-5 gap-1.5 sm:flex sm:flex-wrap">
            {SPEEDS.map(speed => {
              const current = reading.autoMode === false && reading.fanSpeed === speed;
              return (
                <button
                  key={speed}
                  type="button"
                  aria-pressed={current}
                  aria-label={`Speed ${speed}`}
                  onClick={() => send({ fanSpeed: speed })}
                  className={cn(
                    "h-9 rounded-md border text-sm tabular-nums sm:w-9 outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
                    current
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:bg-accent"
                  )}
                >
                  {speed}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label htmlFor="sleep-timer" className="text-muted-foreground">
            Sleep timer
          </label>
          <select
            id="sleep-timer"
            value={timerLeft}
            disabled={busy || off}
            onChange={event => send({ sleepTimer: Number(event.target.value) })}
            className="h-9 rounded-md border border-border bg-card px-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          >
            {timerLeft > 0 && !TIMERS.includes(timerLeft) && (
              <option value={timerLeft}>{durationText(timerLeft)} left</option>
            )}
            {TIMERS.map(minutes => (
              <option key={minutes} value={minutes}>
                {minutes === 0 ? "Off" : durationText(minutes)}
              </option>
            ))}
          </select>
          {timerLeft > 0 && (
            <span className="text-xs text-muted-foreground">Turns off in {durationText(timerLeft)}</span>
          )}
        </div>

        {busy && (
          <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            Sending to the purifier…
          </p>
        )}
        {control.error && (
          <p role="alert" className="text-xs text-destructive">
            {control.error.message}
          </p>
        )}
        {note && (
          <p role="status" className="text-xs text-muted-foreground">
            {note}
          </p>
        )}
        {reading.monitoring === false && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="size-3.5" aria-hidden />
            Continuous monitoring is off, so PM is only measured while the fan runs.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Toggle({
  label,
  on,
  disabled,
  onChange,
}: {
  label: string;
  on: boolean | null;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
      <span className="text-sm">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on === true}
        aria-label={label}
        disabled={disabled || on === null}
        onClick={() => onChange(!on)}
        className={cn(
          "relative h-6 w-10 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
          on ? "bg-primary" : "bg-input"
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-0.5 left-0.5 size-5 rounded-full bg-card shadow-sm transition-transform",
            on && "translate-x-4"
          )}
        />
      </button>
    </div>
  );
}
