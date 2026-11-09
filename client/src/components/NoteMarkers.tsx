import { laneChips, NOTE_KINDS, noteSummary, noteTimeText } from "@/lib/notes";
import { cn } from "@/lib/utils";
import type { Note } from "@shared/notes";

/** The strip above a chart's plot that holds the chips, in pixels. */
export const NOTE_LANE = 24;
const CHIP_R = 9;
/** Chips closer than this share one: a chip's width and a 2px gap. */
const CHIP_GAP = CHIP_R * 2 + 2;
/** How many notes a tooltip lists before it counts the rest. */
const TOOLTIP_NOTES = 3;

/** What Recharts' <Customized> passes in about the chart. */
interface ChartState {
  xAxisMap?: Record<string, { scale: (value: number) => number }>;
  offset?: { top: number; left: number; width: number; height: number };
}

/**
 * Notes over a time chart, drawn through Recharts' <Customized>, which
 * passes in the chart's scale and plot area. Each note gets a dashed line at
 * its start and, for a span, a faint band; above the plot, a chip shows its
 * icon, or how many notes are too close together to show apart. Neutral, so
 * the data keeps the color; the icon tells notes apart. A chip is a button
 * that opens its notes, which are also listed under the charts.
 */
export function NoteMarkers({
  notes,
  span,
  onSelect,
  xAxisMap,
  offset,
}: {
  notes: Note[];
  span: [number, number];
  /** Opens the notes behind a chip. */
  onSelect?: (notes: Note[]) => void;
} & ChartState) {
  const scale = xAxisMap ? Object.values(xAxisMap)[0]?.scale : undefined;
  if (!scale || !offset) return null;
  const top = offset.top;
  const left = offset.left;
  const right = offset.left + offset.width;
  // Kept inside the plot's width, so a chip at either edge isn't cut off.
  const chipX = (t: number) => Math.min(Math.max(scale(t), left + CHIP_R), right);
  const chips = laneChips(notes, span, chipX, CHIP_GAP);
  const cy = top - NOTE_LANE / 2;

  return (
    <g>
      {/* Lines and bands are decoration; the chips below carry each note's name. */}
      <g aria-hidden>
        {notes.map(note => {
          const start = note.startsAt.getTime();
          const x1 = scale(Math.max(start, span[0]));
          return (
            <g key={note.id}>
              {note.endsAt && (
                <rect
                  x={x1}
                  y={top}
                  width={Math.max(1, scale(Math.min(note.endsAt.getTime(), span[1])) - x1)}
                  height={offset.height}
                  fill="var(--foreground)"
                  fillOpacity={0.07}
                />
              )}
              {start >= span[0] && (
                <line
                  x1={x1}
                  x2={x1}
                  y1={top}
                  y2={top + offset.height}
                  stroke="var(--foreground)"
                  strokeOpacity={0.5}
                  strokeDasharray="3 3"
                />
              )}
            </g>
          );
        })}
      </g>
      {chips.map(chip => {
        const first = chip.notes[0]!;
        const Icon = NOTE_KINDS[first.category].icon;
        const summary = chip.notes.map(note => noteSummary(note));
        const open = onSelect && (() => onSelect(chip.notes));
        return (
          <g
            key={first.id}
            role={open ? "button" : undefined}
            tabIndex={open ? 0 : undefined}
            aria-label={
              open &&
              (chip.notes.length === 1 ? `Note: ${summary[0]}` : `${chip.notes.length} notes: ${summary.join("; ")}`)
            }
            onClick={
              open &&
              (event => {
                // Not also a click on the chart, which would add a note.
                event.stopPropagation();
                open();
              })
            }
            onKeyDown={
              open &&
              (event => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                open();
              })
            }
            className={cn(
              open &&
                "cursor-pointer outline-none [&:focus-visible>circle]:[stroke-opacity:1] [&:focus-visible>circle]:[stroke-width:2] [&:focus-visible>circle]:[stroke:var(--ring)] [&:hover>circle]:[stroke-opacity:1]"
            )}
          >
            {/* A browser tooltip on hover. */}
            <title>{summary.join("\n")}</title>
            <circle
              cx={chip.x}
              cy={cy}
              r={CHIP_R}
              fill="var(--card)"
              stroke="var(--foreground)"
              strokeOpacity={0.45}
            />
            {chip.notes.length === 1 ? (
              <Icon x={chip.x - 6} y={cy - 6} width={12} height={12} color="var(--foreground)" />
            ) : (
              <text
                x={chip.x}
                y={cy}
                dy="0.35em"
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                fill="var(--foreground)"
              >
                {chip.notes.length}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** The notes at the time a chart's tooltip is showing. */
export function TooltipNotes({ notes }: { notes: Note[] }) {
  if (notes.length === 0) return null;
  const more = notes.length - TOOLTIP_NOTES;
  return (
    <div className="grid max-w-60 gap-1.5 border-t border-border/50 pt-1.5">
      {notes.slice(0, TOOLTIP_NOTES).map(note => {
        const kind = NOTE_KINDS[note.category];
        const Icon = kind.icon;
        return (
          <div key={note.id} className="flex items-start gap-1.5">
            <Icon className="mt-px size-3 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 space-y-0.5">
              <p className="font-medium">{kind.label}</p>
              <p className="text-muted-foreground">{noteTimeText(note, { withDate: true })}</p>
              {note.details && <p className="line-clamp-2 break-words text-muted-foreground">{note.details}</p>}
            </div>
          </div>
        );
      })}
      {more > 0 && (
        <p className="text-muted-foreground">
          {more} more, listed under the charts
        </p>
      )}
    </div>
  );
}
