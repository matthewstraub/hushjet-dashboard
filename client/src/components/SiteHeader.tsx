import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { LogOut } from "lucide-react";
import { Link, useLocation } from "wouter";

const PAGES = [
  { href: "/", label: "Dashboard" },
  { href: "/info", label: "Info" },
];

/** The title, the page's own controls, sign-out, and tabs for the pages. */
export function SiteHeader({ subtitle, actions }: { subtitle: string; actions?: React.ReactNode }) {
  const me = trpc.auth.me.useQuery();
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => window.location.assign("/login"),
  });
  const [location] = useLocation();

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">HushJet</h1>
          <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {me.data?.signInRequired && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              <LogOut aria-hidden />
              Sign out
            </Button>
          )}
        </div>
      </div>
      <nav aria-label="Pages" className="mx-auto flex max-w-5xl gap-5 px-4 pt-3">
        {PAGES.map(page => {
          const active = location === page.href;
          return (
            <Link
              key={page.href}
              href={page.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px rounded-t-sm border-b-2 pb-2 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                active
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {page.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
