// toast.tsx — lightweight notifications, shared by the apps that mount this shell. No external
// library. Render <Toaster/> once at the app root; call `showToast({ message, variant })` from
// anywhere. Stacks bottom-right. A SUCCESS leaves on its own after `duration` ms; an ERROR
// stays until dismissed, and hovering either one holds it.

import { CheckCircle2, X, XCircle } from "@frediverse/ui/icons";
import { useEffect, useState } from "react";

const cx = (...parts: (string | false | undefined)[]): string =>
  parts.filter(Boolean).join(" ");

export interface ToastItem {
  id: number;
  message: string;
  variant: "success" | "error";
  /** Milliseconds before it leaves on its own, or 0 to stay until dismissed. */
  duration: number;
}

/** How long a success stays on screen; an error gets 0, meaning it waits to be dismissed. */
export const TOAST_DURATION_MS = 3000;

let nextId = 0;
const listeners = new Set<(t: ToastItem) => void>();

export function showToast(opts: {
  message: string;
  variant?: "success" | "error";
  duration?: number;
}): void {
  const variant = opts.variant ?? "success";
  const t: ToastItem = {
    id: nextId++,
    message: opts.message,
    variant,
    // An error nobody read is an error that did not happen, so it waits to be dismissed.
    duration: opts.duration ?? (variant === "error" ? 0 : TOAST_DURATION_MS),
  };
  for (const l of listeners) l(t);
}

export function Toaster() {
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

  return (
    <div className="pointer-events-none fixed bottom-10 right-4 z-50 flex flex-col items-end gap-2">
      {items.map((t) => (
        <Toast key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function Toast({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: () => void;
}) {
  // Hovering holds the toast: reading a message must not be a race against its own timer.
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!item.duration || held) return;
    const timer = setTimeout(onDismiss, item.duration);
    return () => clearTimeout(timer);
  }, [item.duration, held, onDismiss]);

  const Icon = item.variant === "success" ? CheckCircle2 : XCircle;
  const iconCls =
    item.variant === "success" ? "text-emerald-500" : "text-red-500";

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
        aria-label="dismiss"
        title="dismiss"
        className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
