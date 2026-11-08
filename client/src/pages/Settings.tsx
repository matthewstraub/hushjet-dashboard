import { SiteHeader } from "@/components/SiteHeader";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { useTheme, type ThemePreference } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

/** Settings for the dashboard itself, kept in this browser. */
export default function Settings() {
  const { systemTheme, preference, setPreference } = useTheme();
  const options: { value: ThemePreference; label: string; detail: string; icon: LucideIcon }[] = [
    { value: "system", label: "System", detail: `Matches this device, ${systemTheme} right now`, icon: Monitor },
    { value: "light", label: "Light", detail: "Light backgrounds, dark text", icon: Sun },
    { value: "dark", label: "Dark", detail: "Dark backgrounds, light text", icon: Moon },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader subtitle="Settings for this dashboard" />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <Card>
          <CardHeader>
            <h2 className="font-semibold leading-none">Appearance</h2>
            <CardDescription>Saved in this browser, so each device can have its own.</CardDescription>
          </CardHeader>
          <CardContent>
            <fieldset>
              <legend className="mb-3 text-sm font-medium">Theme</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                {options.map(option => {
                  const selected = preference === option.value;
                  const Icon = option.icon;
                  return (
                    <label
                      key={option.value}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                        selected ? "border-primary" : "border-border hover:bg-accent"
                      )}
                    >
                      <input
                        type="radio"
                        name="theme"
                        value={option.value}
                        checked={selected}
                        onChange={() => setPreference(option.value)}
                        className="mt-0.5 accent-primary"
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          <Icon className="size-4 text-muted-foreground" aria-hidden />
                          {option.label}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{option.detail}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
