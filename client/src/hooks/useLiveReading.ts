import { trpc } from "@/lib/trpc";

/**
 * The purifier's live reading and Refresh for a new one. Pages share the one
 * cached query, so switching tabs doesn't read the purifier again.
 */
export function useLiveReading() {
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
  return { live, refresh, busy: live.isFetching || refresh.isPending };
}
