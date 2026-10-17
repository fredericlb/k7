// NameForm.tsx — the one form every "name a folder" dialog of the home page asks through: a name,
// the folder it becomes shown BEFORE confirming, the step a long wait narrates and the error. The
// folder line is the point: a refused name says so here rather than after a round trip.
// See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Loader2 } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { type ReactNode, useState } from "react";
import { m } from "../paraglide/messages.js";

/** A submit's busy flag, its narrated step and its error — `run` clears all three, then narrates `work`. */
export function useNameSubmit() {
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const run = (
    work: (onStep: (s: string) => void) => Promise<void>,
    onDone: () => void,
  ) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setStep("");
    void work(setStep)
      .then(onDone)
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setBusy(false);
        setStep("");
      });
  };
  return { busy, step, error, run };
}

export interface NameFieldProps {
  name: string;
  onName: (name: string) => void;
  onSubmit: () => void;
  busy: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** Why the name is refused, or "" — shown in place of the preview. */
  badName?: string;
  /** What will be created when the name is fine: the folder, usually. */
  preview: ReactNode;
  /** A line under the preview, for what the action costs. */
  note?: ReactNode;
  step: string;
  error: string;
}

/** The name, the folder it becomes, the step under way and the error. */
export function NameField({
  name,
  onName,
  onSubmit,
  busy,
  placeholder,
  autoFocus = true,
  badName,
  preview,
  note,
  step,
  error,
}: NameFieldProps) {
  return (
    <>
      <Input
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={name}
        disabled={busy}
        onChange={(e) => onName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
      />
      <p className="font-mono text-muted-foreground text-xs">
        {/* An empty field is not yet a mistake: the refusal waits for something typed, Create staying greyed meanwhile. */}
        {badName && name.trim() ? (
          // A sentence, so the body face: the mono is for the folder path the line shows otherwise.
          <span className="font-sans text-destructive">{badName}</span>
        ) : (
          preview || " "
        )}
      </p>
      {note}
      {step && (
        <p className="text-muted-foreground text-xs">
          <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
          {step}
        </p>
      )}
      {error && (
        <p className="whitespace-pre-wrap rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-xs">
          {error}
        </p>
      )}
    </>
  );
}

/** A dialog around a NameField: `before` sits above the name, and the footer is Cancel and `submit`. */
export function NameFormDialog({
  open,
  onClose,
  title,
  description,
  before,
  submit,
  canSubmit,
  wide = false,
  ...field
}: NameFieldProps & {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description: ReactNode;
  before?: ReactNode;
  submit: ReactNode;
  canSubmit: boolean;
  /** Room for a picker of cards above the name, as New project's archetypes. */
  wide?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !field.busy && !o && onClose()}>
      <DialogContent
        className={
          wide ? "max-h-[90dvh] overflow-y-auto sm:max-w-2xl" : "max-w-lg"
        }
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {before}
          <NameField {...field} />
        </div>
        <DialogFooter>
          <Button variant="secondary" disabled={field.busy} onClick={onClose}>
            {m["common.cancel"]()}
          </Button>
          <Button disabled={field.busy || !canSubmit} onClick={field.onSubmit}>
            {field.busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
