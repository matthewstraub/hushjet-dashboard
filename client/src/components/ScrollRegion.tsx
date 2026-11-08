import { cn } from "@/lib/utils";

/**
 * The box a wide table scrolls sideways in on a narrow screen. It takes
 * keyboard focus, so the arrow keys reach every column, and it has a name
 * for screen readers.
 */
export function ScrollRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        "overflow-x-auto rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className
      )}
    >
      {children}
    </div>
  );
}
