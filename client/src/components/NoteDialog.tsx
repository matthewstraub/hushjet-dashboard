import { NoteForm } from "@/components/NoteForm";
import { NoteList } from "@/components/NoteList";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Note } from "@shared/notes";
import { useLayoutEffect, useRef, useState } from "react";

/** What the note pop-up shows. */
export type NoteDialogState =
  /** A new note, at a time clicked on a chart, or now. */
  | { mode: "add"; startsAt?: Date }
  | { mode: "edit"; note: Note }
  /** The notes behind a chart marker, to read, or for the admin role to pick one to edit. */
  | { mode: "view"; notes: Note[] };

/**
 * The pop-up for adding a note, changing one, or reading the notes behind a
 * chart marker. Only the admin role gets the forms; anyone can read.
 */
export function NoteDialog({
  state,
  canEdit,
  onClose,
}: {
  state: NoteDialogState | null;
  canEdit: boolean;
  onClose: () => void;
}) {
  // Radix gives focus back only to a Dialog.Trigger, and this opens from
  // buttons, chart markers and list items, so it keeps what had focus. A
  // layout effect runs before the dialog moves focus inside itself.
  const opener = useRef<HTMLElement | SVGElement | null>(null);
  const open = state !== null;
  useLayoutEffect(() => {
    if (open) opener.current = document.activeElement as HTMLElement | SVGElement | null;
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={next => !next && onClose()}>
      {state && (
        <DialogBody
          state={state}
          canEdit={canEdit}
          onClose={onClose}
          onCloseAutoFocus={event => {
            event.preventDefault();
            // Gone after a delete, in which case focus stays on the page.
            if (opener.current?.isConnected) opener.current.focus();
          }}
        />
      )}
    </Dialog>
  );
}

function DialogBody({
  state,
  canEdit,
  onClose,
  onCloseAutoFocus,
}: {
  state: NoteDialogState;
  canEdit: boolean;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  // A note picked from the marker's list, to edit here.
  const [picked, setPicked] = useState<Note | null>(null);
  const editing = state.mode === "edit" ? state.note : picked;

  let title: string;
  let description: string;
  let body: React.ReactNode;
  if (state.mode === "add") {
    title = "Add a note";
    description =
      "Note what was going on at home, like cooking or open windows. It's marked on the charts, so you can see how the air changed.";
    body = <NoteForm startsAt={state.startsAt} onDone={onClose} onCancel={onClose} />;
  } else if (editing && canEdit) {
    title = "Edit note";
    description = "Changes show on the charts right away.";
    // Cancel goes back to the marker's list when the note came from one.
    body = <NoteForm note={editing} onDone={onClose} onCancel={picked ? () => setPicked(null) : onClose} />;
  } else {
    const notes = state.mode === "view" ? state.notes : [state.note];
    title = notes.length === 1 ? "Note" : `${notes.length} notes`;
    description =
      notes.length > 1
        ? "They're close together on the chart, so they share one marker."
        : canEdit
          ? "Marked on the charts at this time."
          : "Only the admin password can change notes.";
    body = <NoteList notes={notes} byDay={false} onEdit={canEdit ? setPicked : undefined} />;
  }

  return (
    <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {body}
    </DialogContent>
  );
}
