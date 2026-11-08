import { PurifierControls } from "@/components/PurifierControls";
import { RefreshActions } from "@/components/RefreshActions";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLiveReading } from "@/hooks/useLiveReading";
import { ADMIN_SIGN_IN_HREF } from "@/lib/signIn";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Lock, LogIn } from "lucide-react";

const SUBTITLE = "Change the purifier's settings";

/**
 * The purifier's settings as switches, on a tab of their own so nothing on
 * the dashboard can change the purifier. Only the admin role gets them; the
 * server refuses changes from anyone else either way.
 */
export default function Controls() {
  const me = trpc.auth.me.useQuery();
  if (me.data?.role === "admin") return <AdminControls />;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader subtitle={SUBTITLE} />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        {me.isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Lock className="size-4 text-muted-foreground" aria-hidden />
                Admin password needed
              </CardTitle>
              <CardDescription>
                {me.data?.adminEnabled === false
                  ? "This site has no admin password, so the purifier's settings can only be changed in the MyDyson app."
                  : "Sign in with the admin password to change the purifier's settings here."}{" "}
                The Dashboard shows the current settings.
              </CardDescription>
            </CardHeader>
            {me.data?.adminEnabled && (
              <CardContent>
                <Button asChild size="sm">
                  <a href={ADMIN_SIGN_IN_HREF}>
                    <LogIn aria-hidden />
                    Sign in as admin
                  </a>
                </Button>
              </CardContent>
            )}
          </Card>
        )}
      </main>
    </div>
  );
}

function AdminControls() {
  const { live, refresh, busy } = useLiveReading();
  const reading = live.data?.reading;
  // With a reading on screen, only a failed Refresh is news.
  const error = reading ? refresh.error : (live.error ?? refresh.error);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader
        subtitle={SUBTITLE}
        actions={<RefreshActions takenAt={reading?.takenAt} busy={busy} onRefresh={() => refresh.mutate()} />}
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
        {live.isLoading ? <Skeleton className="h-72 w-full" /> : reading && <PurifierControls reading={reading} />}
      </main>
    </div>
  );
}
