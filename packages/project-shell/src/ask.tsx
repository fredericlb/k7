// ask.tsx — a confirmation or a one-field question, as a promise. The shape `toast` already has,
// and no external library either, for the same reason it has none: this package draws before an
// app is set up. It exists because nine call sites had settled for `window.confirm`, an OS box
// that ignores the app's Escape ladder, its focus and its language. Render <AskHost/> once beside
// <Toaster/>. See docs/ask.md.

import { useEffect, useRef, useState } from "react";

const cx = (...parts: (string | false | undefined)[]): string =>
  parts.filter(Boolean).join(" ");

interface Common {
  title: string;
  /** The consequence, in the words the person needs — newlines survive, unlike in a native box. */
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface AskConfirm extends Common {
  kind: "confirm";
  /** Colour the confirm as destructive: this one does not come back. */
  danger?: boolean;
}

export interface AskText extends Common {
  kind: "text";
  /** What the field starts with — empty when there is nothing to suggest. */
  initial?: string;
  placeholder?: string;
  /** Why this value will not do, or "" when it will — re-asked per keystroke, so the button can refuse in place. */
  validate?: (value: string) => string;
}

type Pending = (AskConfirm | AskText) & {
  id: number;
  settle: (v: boolean | string | null) => void;
};

let nextId = 0;
let listener: ((p: Pending) => void) | null = null;

/** Yes or no, answering false when it is dismissed however that happens. */
export function askConfirm(q: Omit<AskConfirm, "kind">): Promise<boolean> {
  return new Promise((resolve) => {
    // No host mounted: the answer is NO, which is the safe half of every question this asks.
    if (!listener) return resolve(false);
    listener({ ...q, kind: "confirm", id: nextId++, settle: resolve as never });
  });
}

/** One field, answering null when cancelled — never "", which a caller cannot tell from an empty answer. */
export function askText(q: Omit<AskText, "kind">): Promise<string | null> {
  return new Promise((resolve) => {
    if (!listener) return resolve(null);
    listener({ ...q, kind: "text", id: nextId++, settle: resolve as never });
  });
}

/** Mount once, at the app root. One question at a time: a second would be a stack nobody asked for. */
export function AskHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    listener = setPending;
    return () => {
      listener = null;
    };
  }, []);
  if (!pending) return null;
  // Keyed on the id so a second question opens with its own field rather than the last one's text.
  return (
    <AskDialog
      key={pending.id}
      pending={pending}
      onDone={(v) => {
        setPending(null);
        pending.settle(v);
      }}
    />
  );
}

function AskDialog({
  pending,
  onDone,
}: {
  pending: Pending;
  onDone: (v: boolean | string | null) => void;
}) {
  const text = pending.kind === "text" ? pending : null;
  const [value, setValue] = useState(text?.initial ?? "");
  const field = useRef<HTMLInputElement | null>(null);
  const invalid = text?.validate ? text.validate(value) : "";
  // A cancel is the same answer however it arrives — Escape, the backdrop, the button.
  const cancel = () => onDone(text ? null : false);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={pending.title}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") cancel();
        if (e.key === "Enter" && !invalid) onDone(text ? value : true);
      }}
    >
      <button
        type="button"
        aria-label={pending.cancelLabel ?? "Annuler"}
        className="absolute inset-0 bg-black/50"
        onClick={cancel}
      />
      <div className="relative flex w-[min(28rem,92vw)] flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-xl">
        <h2 className="text-sm font-semibold text-foreground">
          {pending.title}
        </h2>
        {pending.body ? (
          <p className="whitespace-pre-line text-sm text-muted-foreground">
            {pending.body}
          </p>
        ) : null}
        {text ? (
          <div className="flex flex-col gap-1">
            <input
              ref={field}
              value={value}
              placeholder={text.placeholder}
              onChange={(e) => setValue(e.target.value)}
              className="h-8 rounded border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-primary"
            />
            {invalid ? (
              <span className="text-xs text-destructive">{invalid}</span>
            ) : null}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            className="rounded border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
          >
            {pending.cancelLabel ?? "Annuler"}
          </button>
          <button
            type="button"
            disabled={!!invalid}
            onClick={() => onDone(text ? value : true)}
            className={cx(
              "rounded px-3 py-1.5 text-sm disabled:opacity-50",
              pending.kind === "confirm" && pending.danger
                ? "bg-destructive text-white hover:bg-destructive/90"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            {pending.confirmLabel ?? "Confirmer"}
          </button>
        </div>
      </div>
    </div>
  );
}
