import { NoteDialog, type NoteDialogState } from "@/components/NoteDialog";
import { NoteList } from "@/components/NoteList";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { adminSignInHref } from "@/lib/signIn";
import { trpc } from "@/lib/trpc";
import { Plus } from "lucide-react";
import { useState } from "react";

const PAGE = 50;

/**
 * Every note, newest first, a page at a time: the Dashboard lists only the
 * notes in its chart range. Anyone signed in can read them; the admin role
 * adds, changes and deletes them, in the same pop-up as on the Dashboard.
 */
export default function Notes() {
  const me = trpc.auth.me.useQuery();
  const canEdit = me.data?.role === "admin";
  const list = trpc.notes.list.useInfiniteQuery(
    { limit: PAGE },
    { getNextPageParam: page => page.nextCursor }
  );
  const notes = list.data?.pages.flatMap(page => page.notes) ?? [];
  const databaseConfigured = list.data?.pages[0]?.databaseConfigured;
  const [dialog, setDialog] = useState<NoteDialogState | null>(null);

  let body;
  if (list.isLoading) {
    body = <Skeleton className="h-32 w-full" />;
  } else if (list.error) {
    body = <p className="text-sm text-destructive">{`Couldn't load the notes: ${list.error.message}`}</p>;
  } else if (databaseConfigured === false) {
    body = <p className="text-sm text-muted-foreground">Notes need a database, like the history.</p>;
  } else if (notes.length === 0) {
    body = (
      <p className="text-sm text-muted-foreground">
        No notes yet. Add one when you cook, clean, open the windows, or the heat or air
        conditioning comes on, and the charts show how the air changed.
      </p>
    );
  } else {
    body = (
      <div className="space-y-6">
        <NoteList notes={notes} onEdit={canEdit ? note => setDialog({ mode: "edit", note }) : undefined} />
        {list.hasNextPage && (
          <Button variant="outline" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
            {list.isFetchingNextPage ? "Loading…" : "Show older notes"}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader subtitle="What was going on at home" />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <Card>
          <CardHeader>
            <h2 className="font-semibold leading-none">All notes</h2>
            <CardDescription>
              Newest first, in your time zone. The Dashboard marks them on its charts.
              {!canEdit && me.data && (
                <>
                  {" "}
                  Only the admin password can add or change notes.
                  {me.data.adminEnabled && (
                    <>
                      {" "}
                      <a
                        href={adminSignInHref("/notes")}
                        className="rounded-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        Sign in as admin
                      </a>
                    </>
                  )}
                </>
              )}
            </CardDescription>
            {canEdit && databaseConfigured && (
              <CardAction>
                <Button size="sm" variant="outline" onClick={() => setDialog({ mode: "add" })}>
                  <Plus aria-hidden />
                  Add note
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>{body}</CardContent>
        </Card>
      </main>
      <NoteDialog state={dialog} canEdit={canEdit} onClose={() => setDialog(null)} />
    </div>
  );
}
