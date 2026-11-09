import { Button } from "@/components/ui/button";
import { fromLocalInput, NOTE_KINDS, toLocalInput } from "@/lib/notes";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  NOTE_CATEGORIES,
  NOTE_DETAILS_MAX,
  noteProblem,
  type Note,
  type NoteCategory,
  type NoteInput,
} from "@shared/notes";
import { Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Like the shadcn input: 16px text on phones, so iOS doesn't zoom in when a
 * field is tapped, except under 360px wide, where a date and time box only
 * fits at 14px.
 */
const FIELD =
  "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 max-[359px]:text-sm sm:text-sm dark:bg-input/30";
const LABEL_LINE = "flex items-baseline justify-between gap-2";
/** Underlined like the site's other inline links, with padding for a bigger tap target. */
const TEXT_BUTTON =
  "-my-1 rounded-sm px-1 py-1 text-sm text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * Add a note, or change or delete one. A new note is for now unless it
 * comes with a time, like the one clicked on a chart, or its time is
 * changed: until then the time shown keeps up with the clock, so a form left
 * open still saves the time it's sent.
 */
export function NoteForm({
  note,
  startsAt,
  onDone,
  onCancel,
}: {
  /** The note to change; without one, the form adds a note. */
  note?: Note;
  /** When a new note starts, instead of now. */
  startsAt?: Date;
  /** After a note is saved or deleted. */
  onDone?: () => void;
  /** Adds a Cancel button. */
  onCancel?: () => void;
}) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const utils = trpc.useUtils();
  const [category, setCategory] = useState<NoteCategory | null>(note?.category ?? null);
  const [start, setStart] = useState(() => toLocalInput(note?.startsAt ?? startsAt ?? new Date()));
  const [startChanged, setStartChanged] = useState(Boolean(note || startsAt));
  const [end, setEnd] = useState(note?.endsAt ? toLocalInput(note.endsAt) : "");
  const [details, setDetails] = useState(note?.details ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (startChanged) return;
    const timer = setInterval(() => setStart(toLocalInput(new Date())), 15_000);
    return () => clearInterval(timer);
  }, [startChanged]);

  // Editing replaces the note's Edit button, so focus moves into the form.
  useEffect(() => {
    if (note) form.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
  }, [note]);

  const finish = async (message: string) => {
    await utils.notes.invalidate();
    toast.success(message);
    onDone?.();
  };
  const create = trpc.notes.create.useMutation({
    onSuccess: async () => {
      setCategory(null);
      setStart(toLocalInput(new Date()));
      setStartChanged(false);
      setEnd("");
      setDetails("");
      await finish("Note added");
    },
  });
  const update = trpc.notes.update.useMutation({ onSuccess: () => finish("Note saved") });
  const remove = trpc.notes.delete.useMutation({ onSuccess: () => finish("Note deleted") });
  const busy = create.isPending || update.isPending || remove.isPending;
  const failed = create.error ?? update.error ?? remove.error;
  const message = problem ?? failed?.message;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!category) return setProblem("Pick what happened");
    const startsAt = fromLocalInput(startChanged ? start : toLocalInput(new Date()));
    if (!startsAt) return setProblem("Enter when it started");
    const endsAt = end ? fromLocalInput(end) : null;
    if (end && !endsAt) return setProblem("Enter when it ended, or leave it empty");
    const input: NoteInput = { category, startsAt, endsAt, details: details.trim() };
    const found = noteProblem(input);
    setProblem(found);
    if (found) return;
    if (note) update.mutate({ id: note.id, ...input });
    else create.mutate(input);
  };

  return (
    <form ref={form} onSubmit={submit} noValidate className="space-y-4">
      <fieldset>
        <legend className="text-sm font-medium">What happened</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {NOTE_CATEGORIES.map(value => {
            const kind = NOTE_KINDS[value];
            const Icon = kind.icon;
            const checked = category === value;
            return (
              <label
                key={value}
                className={cn(
                  "inline-flex h-9 cursor-pointer select-none items-center gap-1.5 rounded-md border px-3 text-sm transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                  checked
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input hover:bg-accent dark:hover:bg-input/50"
                )}
              >
                <input
                  type="radio"
                  name={`${id}-category`}
                  value={value}
                  checked={checked}
                  onChange={() => {
                    setCategory(value);
                    setProblem(null);
                  }}
                  className="sr-only"
                />
                <Icon className="size-4" aria-hidden />
                {kind.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <div className={LABEL_LINE}>
            <label htmlFor={`${id}-start`} className="text-sm font-medium">
              When
            </label>
          </div>
          <input
            id={`${id}-start`}
            type="datetime-local"
            required
            value={start}
            onChange={event => {
              setStart(event.target.value);
              setStartChanged(true);
            }}
            className={FIELD}
          />
        </div>
        <div className="min-w-0 space-y-2">
          <div className={LABEL_LINE}>
            <label htmlFor={`${id}-end`} className="text-sm font-medium">
              Until <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            {/* Beside the label, so the date and time box gets the full width. */}
            {end ? (
              <button type="button" className={TEXT_BUTTON} aria-label="Clear Until" onClick={() => setEnd("")}>
                Clear
              </button>
            ) : (
              <button
                type="button"
                className={TEXT_BUTTON}
                aria-label="Until now"
                onClick={() => setEnd(toLocalInput(new Date()))}
              >
                Now
              </button>
            )}
          </div>
          <input
            id={`${id}-end`}
            type="datetime-local"
            value={end}
            min={start}
            onChange={event => setEnd(event.target.value)}
            className={FIELD}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor={`${id}-details`} className="block text-sm font-medium">
          Details{" "}
          {category !== "other" && <span className="font-normal text-muted-foreground">(optional)</span>}
        </label>
        <textarea
          id={`${id}-details`}
          value={details}
          onChange={event => setDetails(event.target.value)}
          rows={2}
          maxLength={NOTE_DETAILS_MAX}
          placeholder={category ? `e.g. ${NOTE_KINDS[category].example}` : undefined}
          className={cn(FIELD, "h-auto min-h-16 py-2")}
        />
      </div>

      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy}>
          {note ? "Save" : "Add note"}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        {note &&
          (confirmingDelete ? (
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <span className="text-sm">Delete this note?</span>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => remove.mutate({ id: note.id })}
              >
                Delete
              </Button>
              {/* Focus starts on the safe choice; keeping it goes back to Delete. */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                autoFocus
                onClick={() => {
                  setConfirmingDelete(false);
                  requestAnimationFrame(() => deleteButton.current?.focus());
                }}
              >
                Keep it
              </Button>
            </span>
          ) : (
            <Button
              ref={deleteButton}
              type="button"
              variant="ghost"
              className="ml-auto text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 aria-hidden />
              Delete
            </Button>
          ))}
      </div>
    </form>
  );
}
