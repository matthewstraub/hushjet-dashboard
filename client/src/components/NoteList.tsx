import { Button } from "@/components/ui/button";
import { dayLabel } from "@/lib/format";
import { localDay, NOTE_KINDS, notesByDay, noteTimeText } from "@/lib/notes";
import type { Note } from "@shared/notes";
import { Pencil } from "lucide-react";

/**
 * Notes as a list, newest first. By day, each day under its own heading;
 * otherwise flat, with each note's date. `onEdit` adds an Edit button, for
 * the admin role.
 */
export function NoteList({
  notes,
  byDay = true,
  headingLevel = 3,
  onEdit,
}: {
  notes: Note[];
  byDay?: boolean;
  /** For each day's heading. */
  headingLevel?: 3 | 4;
  onEdit?: (note: Note) => void;
}) {
  if (!byDay) {
    return (
      <ul className="divide-y divide-border">
        {notes.map(note => (
          <li key={note.id} className="py-3 first:pt-0 last:pb-0">
            <NoteItem note={note} withDate onEdit={onEdit} />
          </li>
        ))}
      </ul>
    );
  }
  const today = localDay(new Date());
  const Heading = headingLevel === 3 ? "h3" : "h4";
  return (
    <div className="space-y-4">
      {notesByDay(notes).map(({ day, notes: dayNotes }) => (
        <section key={day} aria-label={dayLabel(day, day === today)}>
          <Heading className="text-sm font-medium text-muted-foreground">{dayLabel(day, day === today)}</Heading>
          <ul className="mt-1 divide-y divide-border">
            {dayNotes.map(note => (
              <li key={note.id} className="py-3 last:pb-0">
                <NoteItem note={note} onEdit={onEdit} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function NoteItem({
  note,
  withDate = false,
  onEdit,
}: {
  note: Note;
  withDate?: boolean;
  onEdit?: (note: Note) => void;
}) {
  const kind = NOTE_KINDS[note.category];
  const Icon = kind.icon;
  const time = noteTimeText(note, { withDate });
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border"
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{kind.label}</p>
        <p className="text-sm text-muted-foreground tabular-nums">{time}</p>
        {note.details && <p className="mt-1 whitespace-pre-line break-words text-sm">{note.details}</p>}
      </div>
      {onEdit && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit ${kind.label}, ${noteTimeText(note, { withDate: true })}`}
          onClick={() => onEdit(note)}
        >
          <Pencil aria-hidden />
        </Button>
      )}
    </div>
  );
}
