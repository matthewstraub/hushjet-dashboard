import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  connectionItem,
  faultsItem,
  firmwareItem,
  historyItem,
  syncItem,
  wifiItem,
  type Faults,
  type Level,
  type StatusItem,
} from "@/lib/status";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { CircleCheck, CircleMinus, CircleX, TriangleAlert, type LucideIcon } from "lucide-react";

// A status color only ever marks the icon; the words beside it say the same thing.
const LEVELS: Record<Level, { icon: LucideIcon; className: string; word: string }> = {
  good: { icon: CircleCheck, className: "text-status-good", word: "OK" },
  warning: { icon: TriangleAlert, className: "text-status-warning", word: "Warning" },
  critical: { icon: CircleX, className: "text-status-critical", word: "Problem" },
  unknown: { icon: CircleMinus, className: "text-muted-foreground", word: "Unknown" },
};

export interface StatusCardProps {
  loading: boolean;
  reading?: { takenAt: string; wifiSignal: number | null; faults: Faults | null };
  device?: { firmwareVersion: string | null; newVersionAvailable: boolean | null };
  error?: { message: string; code?: string } | null;
}

/** The purifier's own checks, the connection to it, and how current the stored data is. */
export function StatusCard({ loading, reading, device, error }: StatusCardProps) {
  const status = trpc.readings.status.useQuery(undefined, { refetchInterval: 2 * 60_000 });
  const now = Date.now();
  const databaseConfigured = status.data?.databaseConfigured ?? true;

  const items: StatusItem[] = [
    faultsItem(reading ? reading.faults : undefined),
    connectionItem({ loading, takenAt: reading?.takenAt, error }),
    wifiItem(reading?.wifiSignal),
    firmwareItem(device),
    syncItem(status.data?.lastSyncAt, databaseConfigured, now),
    historyItem(status.data?.newestSlot, databaseConfigured, now),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Status</CardTitle>
        <CardDescription>The purifier's own checks, and how current the saved data is</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(item => (
            <StatusRow key={item.label} item={item} />
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function StatusRow({ item }: { item: StatusItem }) {
  const { icon: Icon, className, word } = LEVELS[item.level];
  return (
    <div className="flex min-w-0 gap-3">
      <Icon className={cn("mt-0.5 size-4 shrink-0", className)} aria-hidden />
      <div className="min-w-0">
        <dt className="text-sm text-muted-foreground">{item.label}</dt>
        <dd className="text-sm font-medium">
          <span className="sr-only">{word}: </span>
          {item.value}
        </dd>
        {item.detail && <dd className="text-xs break-words text-muted-foreground">{item.detail}</dd>}
      </div>
    </div>
  );
}
