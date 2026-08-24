// toast.tsx — lightweight auto-dismissing notifications, shared by the apps that mount this
// shell. No external library. Render <Toaster/> once at the app root; call
// `showToast({ message, variant })` from anywhere. Stacks bottom-right, auto-dismisses after
// `duration` ms.

import { CheckCircle2, X, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

const cx = (...parts: (string | false | undefined)[]): string =>
  parts.filter(Boolean).join(" ");

export interface ToastItem {
  id: number;
  message: string;
  variant: "success" | "error";
  duration: number;
}

let nextId = 0;
const listeners = new Set<(t: ToastItem) => void>();

export function showToast(opts: {
  message: string;
  variant?: "success" | "error";
  duration?: number;
}): void {
  const t: ToastItem = {
    id: nextId++,
    message: opts.message,
    variant: opts.variant ?? "success",
    duration: opts.duration ?? 3000,
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
  useEffect(() => {
    const timer = setTimeout(onDismiss, item.duration);
    return () => clearTimeout(timer);
  }, [item.duration, onDismiss]);

  const Icon = item.variant === "success" ? CheckCircle2 : XCircle;
  const iconCls =
    item.variant === "success" ? "text-emerald-500" : "text-red-500";

  return (
    <div
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
        className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
