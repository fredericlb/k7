// FloatingCommandBar.tsx — the command bar as a palette: hidden until summoned (Ctrl/⌘+Shift+P,
// double-Shift, a phone's menu), floating at the top of the window, focused. It goes away on
// Escape, on a run, or when it loses the keyboard — never while a command waits on its answers,
// since a gesture in a pane may be what answers it. See ../../docs/commandBar.md.

import { forwardRef, useCallback, useEffect, useRef } from "react";
import { useLatest } from "../hooks/useLatest";
import { useWindowKey } from "../hooks/useWindowKey";
import {
  barTint,
  CommandBar,
  type CommandBarHandle,
  type CommandBarProps,
} from "./CommandBar";

/** Ctrl/⌘+Shift+P summons the bar — captured, so it works from inside the text editor too. */
export function useSummonKey(onSummon: () => void, enabled = true): void {
  useWindowKey(
    (e) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "p") return;
      e.preventDefault();
      e.stopPropagation();
      onSummon();
    },
    { enabled, capture: true },
  );
}

export const FloatingCommandBar = forwardRef<
  CommandBarHandle,
  Omit<CommandBarProps, "autoFocus" | "onClose" | "onFocusChange"> & {
    open: boolean;
    onDismiss: () => void;
    /** Whether a command is waiting on its answers — tints the bar and keeps it up without the keyboard. */
    pending: boolean;
  }
>(function FloatingCommandBar(
  { open, onDismiss, pending, onRun, ...bar },
  ref,
) {
  // Read LIVE by the dismiss timer, which fires after the render that would have told it not to.
  const pendingRef = useLatest(pending);
  const dismissRef = useLatest(onDismiss);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Picking a command hands the keys from the command field to the form one render later: wait before calling a blur 'gone'.
  const onFocusChange = useCallback(
    (focused: boolean) => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (focused) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        if (!pendingRef.current) dismissRef.current();
      }, 150);
    },
    [pendingRef, dismissRef],
  );
  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);
  if (!open) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-50 flex justify-center">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: it only keeps a press on the padding from blurring the field, which would close the bar. */}
      <div
        className={`pointer-events-auto mx-4 flex w-full max-w-2xl items-center rounded-lg border border-border px-3 py-2.5 shadow-2xl ${barTint(pending)}`}
        onMouseDown={(e) => {
          if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
        }}
      >
        <CommandBar
          ref={ref}
          {...bar}
          onRun={(line) => {
            onRun(line);
            onDismiss();
          }}
          onClose={onDismiss}
          onFocusChange={onFocusChange}
          autoFocus
        />
      </div>
    </div>
  );
});
