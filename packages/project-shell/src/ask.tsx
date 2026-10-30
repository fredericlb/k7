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
  /** Other things to do WITH the value, as buttons before the confirm — `askTextAction` only. */
  actions?: { key: string; label: string }[];
  /** Set by `askTextAction`: the answer carries which button gave it. */
  withAction?: boolean;
  /** A button that rewrites the field in place, also pressed by `key` anywhere in the dialog — docs/ask.md. */
  tool?: { label: string; key?: string; press: (value: string) => string };
}

export interface AskChoice extends Common {
  kind: "choice";
  /** The answers, as buttons in this order — the LAST is the default Enter takes. `confirmLabel` is unused. */
  choices: { key: string; label: string }[];
}

/** A text answer and the button that gave it — `"confirm"` for the main one and for Enter. */
export interface TextAnswer {
  value: string;
  action: string;
}

type Answer = boolean | string | TextAnswer | null;

type Pending = (AskConfirm | AskText | AskChoice) & {
  id: number;
  settle: (v: Answer) => void;
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

/** One field and SEVERAL things to do with it: the value and which button was pressed, null when cancelled. */
export function askTextAction(
  q: Omit<AskText, "kind" | "withAction">,
): Promise<TextAnswer | null> {
  return new Promise((resolve) => {
    if (!listener) return resolve(null);
    listener({
      ...q,
      kind: "text",
      withAction: true,
      id: nextId++,
      settle: resolve as never,
    });
  });
}

/** One of several answers, as the chosen key — null when dismissed, never a default nobody picked. */
export function askChoice(
  q: Omit<AskChoice, "kind" | "confirmLabel">,
): Promise<string | null> {
  return new Promise((resolve) => {
    if (!listener) return resolve(null);
    listener({ ...q, kind: "choice", id: nextId++, settle: resolve as never });
  });
}

/** The buttons' words when a question brings none: the host's language, English until it passes its own. */
export interface AskLabels {
  cancel: string;
  confirm: string;
}

const ENGLISH: AskLabels = { cancel: "Cancel", confirm: "Confirm" };

/** Mount once, at the app root. One question at a time: a second would be a stack nobody asked for. */
export function AskHost({ labels }: { labels?: Partial<AskLabels> } = {}) {
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
      pending={{
        ...pending,
        cancelLabel: pending.cancelLabel ?? labels?.cancel ?? ENGLISH.cancel,
        confirmLabel:
          pending.confirmLabel ?? labels?.confirm ?? ENGLISH.confirm,
      }}
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
  onDone: (v: Answer) => void;
}) {
  const text = pending.kind === "text" ? pending : null;
  const choice = pending.kind === "choice" ? pending : null;
  const [value, setValue] = useState(text?.initial ?? "");
  const field = useRef<HTMLInputElement | null>(null);
  // With no field to focus, the dialog itself takes focus, or Escape and Enter would reach nothing.
  const box = useRef<HTMLDivElement | null>(null);
  const invalid = text?.validate ? text.validate(value) : "";
  // A cancel is the same answer however it arrives — Escape, the backdrop, the button.
  const cancel = () => onDone(text || choice ? null : false);
  const tool = text?.tool;
  // Not an updater: `press` keeps state of its own, and StrictMode runs an updater twice.
  const pressTool = () => tool && setValue(tool.press(value));
  // A text answer, wrapped with the button that gave it when the caller asked which.
  const answer = (action: string): Answer =>
    text?.withAction ? { value, action } : value;
  // What Enter answers: the field, the LAST choice, or yes.
  const accept = () =>
    onDone(
      text
        ? answer("confirm")
        : choice
          ? (choice.choices.at(-1)?.key ?? null)
          : true,
    );

  useEffect(() => {
    if (!field.current) return void box.current?.focus();
    field.current.focus();
    field.current.select();
  }, []);

  return (
    <div
      ref={box}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={pending.title}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      onKeyDown={(e) => {
        // The tool's key is the dialog's, not the field's nor the app's (Space would be the transport).
        if (tool?.key && e.key === tool.key) {
          e.preventDefault();
          e.stopPropagation();
          if (!e.repeat) pressTool();
          return;
        }
        if (e.key === "Escape") cancel();
        if (e.key === "Enter" && !invalid) accept();
      }}
    >
      <button
        type="button"
        aria-label={pending.cancelLabel ?? ENGLISH.cancel}
        className="absolute inset-0 bg-black/50"
        onClick={cancel}
      />
      <div className="relative flex max-h-full w-[min(28rem,92vw)] flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-card p-4 shadow-xl">
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
          {tool ? (
            <button
              type="button"
              // Focus stays in the field, so Enter after tapping still answers rather than pressing the tool again.
              onMouseDown={(e) => e.preventDefault()}
              onClick={pressTool}
              className="mr-auto rounded border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted active:bg-accent"
            >
              {tool.label}
            </button>
          ) : null}
          <button
            type="button"
            onClick={cancel}
            className="rounded border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
          >
            {pending.cancelLabel ?? ENGLISH.cancel}
          </button>
          {text?.actions?.map((a) => (
            <button
              key={a.key}
              type="button"
              disabled={!!invalid}
              onClick={() => onDone(answer(a.key))}
              className="rounded border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:opacity-50"
            >
              {a.label}
            </button>
          ))}
          {choice ? (
            // Every answer a button; the last one is the primary, as Enter takes it.
            choice.choices.map((c, i) => (
              <button
                key={c.key}
                type="button"
                onClick={() => onDone(c.key)}
                className={cx(
                  "rounded px-3 py-1.5 text-sm",
                  i === choice.choices.length - 1
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border border-border text-foreground hover:bg-muted",
                )}
              >
                {c.label}
              </button>
            ))
          ) : (
            <button
              type="button"
              disabled={!!invalid}
              onClick={accept}
              className={cx(
                "rounded px-3 py-1.5 text-sm disabled:opacity-50",
                pending.kind === "confirm" && pending.danger
                  ? "bg-destructive text-white hover:bg-destructive/90"
                  : "bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              {pending.confirmLabel ?? ENGLISH.confirm}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
