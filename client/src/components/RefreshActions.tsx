import { Button } from "@/components/ui/button";
import { clockTime } from "@/lib/format";
import { RefreshCw } from "lucide-react";

/** The header's "Updated" time and Refresh button, on pages that show the live reading. */
export function RefreshActions({
  takenAt,
  busy,
  onRefresh,
}: {
  takenAt: string | number | Date | undefined;
  busy: boolean;
  onRefresh: () => void;
}) {
  return (
    <>
      {takenAt !== undefined && (
        <span className="text-xs text-muted-foreground">Updated {clockTime(takenAt)}</span>
      )}
      <Button variant="outline" size="sm" onClick={onRefresh} disabled={busy}>
        <RefreshCw className={busy ? "animate-spin" : undefined} aria-hidden />
        Refresh
      </Button>
    </>
  );
}
