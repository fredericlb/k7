// toast.tsx — lightweight notifications, shared by the apps that mount this shell. No external
// library. Render <Toaster/> once at the app root; call `showToast({ message, variant })` from
// anywhere. Stacks bottom-right, or top-right by `placement`. A SUCCESS leaves after `duration`, a
// WARNING after a longer one; an ERROR stays until dismissed, and hovering any of them holds it.

import { CheckCircle2, TriangleAlert, X, XCircle } from "@frediverse/ui/icons";
import { type CSSProperties, useEffect, useState } from "react";

const cx = (...parts: (string | false | undefined)[]): string =>
  parts.filter(Boolean).join(" ");

export interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  /** Milliseconds before it leaves on its own, or 0 to stay until dismissed. */
  duration: number;
  /** Bottom-right by default; top-right for what must not be missed behind the transport bar. */
  placement: ToastPlacement;
}

export type ToastPlacement = "bottom-right" | "top-right";

/** A warning is something that worked, but not quite as asked: worth reading, not worth blocking on. */
export type ToastVariant = "success" | "warning" | "error";

/** How long a success stays on screen; an error gets 0, meaning it waits to be dismissed. */
export const TOAST_DURATION_MS = 3000;
/** A warning is a sentence to read, not a confirmation to glance at. */
export const WARNING_DURATION_MS = 8000;

let nextId = 0;
const listeners = new Set<(t: ToastItem) => void>();

/** Hear every toast as it is shown — an app keeping a log of what it said; returns the unsubscribe. */
export function onToast(listener: (t: ToastItem) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function showToast(opts: {
  message: string;
  variant?: ToastVariant;
  duration?: number;
  placement?: ToastPlacement;
}): void {
  const variant = opts.variant ?? "success";
  const t: ToastItem = {
    id: nextId++,
    message: opts.message,
    variant,
    // An error nobody read is an error that did not happen, so it waits to be dismissed.
    duration:
      opts.duration ??
      (variant === "error"
        ? 0
        : variant === "warning"
          ? WARNING_DURATION_MS
          : TOAST_DURATION_MS),
    placement: opts.placement ?? "bottom-right",
  };
  for (const l of listeners) l(t);
}

/** `dismissLabel` is the close button's accessible name, in the host app's language. */
export function Toaster({
  dismissLabel = "Dismiss",
}: {
  dismissLabel?: string;
} = {}) {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const add = (t: ToastItem) => setItems((prev) => [...prev, t]);
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);

  const dismiss = (id: number) =>
    setItems((prev) => prev.filter((t) => t.id !== id));

  if (!items.length) return null;

  const stack = (
    placement: ToastPlacement,
    className: string,
    style?: CSSProperties,
  ) => {
    const here = items.filter((t) => t.placement === placement);
    return here.length ? (
      <div
        className={cx(
          "pointer-events-none fixed right-4 z-50 flex flex-col items-end gap-2",
          className,
        )}
        style={style}
      >
        {here.map((t) => (
          <Toast
            key={t.id}
            item={t}
            dismissLabel={dismissLabel}
            onDismiss={() => dismiss(t.id)}
          />
        ))}
      </div>
    ) : null;
  };

  return (
    <>
      {stack("top-right", "top-4")}
      {/* Above whatever bar the app keeps at the bottom (`--toast-bottom`); on a phone, at the top, where no transport is. */}
      {stack(
        "bottom-right",
        "max-sm:!top-4 max-sm:!bottom-auto max-sm:left-4",
        { bottom: "var(--toast-bottom, 2.5rem)" },
      )}
    </>
  );
}

const LOOK = {
  success: { Icon: CheckCircle2, iconCls: "text-emerald-500" },
  warning: { Icon: TriangleAlert, iconCls: "text-amber-500" },
  error: { Icon: XCircle, iconCls: "text-red-500" },
} as const;

function Toast({
  item,
  dismissLabel,
  onDismiss,
}: {
  item: ToastItem;
  dismissLabel: string;
  onDismiss: () => void;
}) {
  // Hovering holds the toast: reading a message must not be a race against its own timer.
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!item.duration || held) return;
    const timer = setTimeout(onDismiss, item.duration);
    return () => clearTimeout(timer);
  }, [item.duration, held, onDismiss]);

  const { Icon, iconCls } = LOOK[item.variant];

  return (
    <div
      // Assertive for an error, which interrupts; polite for a success, which merely confirms.
      role={item.variant === "error" ? "alert" : "status"}
      aria-live={item.variant === "error" ? "assertive" : "polite"}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      className={cx(
        "pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-lg",
        "animate-in slide-in-from-right-4 fade-in duration-200",
      )}
    >
      <Icon className={cx("h-4 w-4 shrink-0", iconCls)} />
      <span className="min-w-0 text-foreground">{item.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={dismissLabel}
        title={dismissLabel}
        className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
