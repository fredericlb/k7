// useCommandKeys.ts — the global keydown listener: every binding names a command and runs
// through the caller's runCommand. Apart from App.tsx so a surface alone on a second device
// keeps the same keyboard — the same standing-aside rules, the same ⌃C exception, the same
// double-Shift. See ../keys.ts and ../../docs/external.md.

import { useEffect, useRef } from "react";
import { type ConditionCtx, keyToken, resolveToken } from "../keys";
import { DOUBLE_SHIFT_MS } from "../shellMeta";

export function useCommandKeys({
  enabled = true,
  effKeys,
  conditions,
  runCommand,
  onDoubleShift,
}: {
  /** False while something OWNS the surface — a docked PANEL is deliberately not one of those, since it leaves the panes on screen. */
  enabled?: boolean;
  /** The person's keymap — the app's simple bindings with their `key:` prefs applied. */
  effKeys: Record<string, string>;
  /** What the caret is over, for the conditional bindings. */
  conditions: ConditionCtx;
  runCommand: (line: string) => void | Promise<void>;
  /** Two lone Shift presses within DOUBLE_SHIFT_MS: whatever this host's command entry is. */
  onDoubleShift: () => void;
}): void {
  // Held in a ref so the two presses survive the listener being rebuilt between them.
  const lastShiftAt = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // Two reasons to stand aside: TYPING owns every key, where a focused CONTROL keeps them all but Space and Escape (docs/shell.md).
      const typing =
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);
      if (typing) return;
      const control =
        !!el &&
        (el.tagName === "BUTTON" ||
          el.tagName === "A" ||
          el.tagName === "SELECT");
      if (control) {
        // What comes back from a focused control is the TRANSPORT's keys, wherever they have been put, plus Escape; Enter stays the control's.
        const t = keyToken(e);
        const passes =
          t === "esc" ||
          (t !== null &&
            t !== "enter" &&
            !!effKeys[t]?.startsWith("transport "));
        if (!passes) return;
      }
      // The command entry: two lone Shift presses within DOUBLE_SHIFT_MS, `e.repeat` filtering a held one; what it OPENS is the host's.
      if (
        e.key === "Shift" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.repeat
      ) {
        const now = e.timeStamp;
        if (now - lastShiftAt.current <= DOUBLE_SHIFT_MS) {
          lastShiftAt.current = 0;
          onDoubleShift();
        } else {
          lastShiftAt.current = now;
        }
        return;
      }
      lastShiftAt.current = 0;
      const token = keyToken(e);
      if (!token) return;
      // ⌃C with text actually SELECTED on the page is the browser's copy and is let through — a grid's rectangle is no DOM selection.
      if (token === "ctrl+c") {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.toString().trim()) return;
      }
      // Through the person's own keymap: their assignments first, the app's conditional bindings as the fallback (keys.ts's resolveToken).
      const command = resolveToken(token, conditions, effKeys);
      if (!command) return;
      e.preventDefault();
      void runCommand(command);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, conditions, effKeys, runCommand, onDoubleShift]);
}
