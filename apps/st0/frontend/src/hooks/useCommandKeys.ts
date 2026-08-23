// useCommandKeys.ts — the global keydown listener: every binding names a command and runs
// through the caller's runCommand. Extracted from App.tsx so a surface alone on a second device
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
  /**
   * False while something OWNS the surface — a settings page, the module builder.
   *
   * The panes these bindings act on are hidden behind such a screen, and Esc must not reach past
   * it to close the slot underneath. A docked PANEL is deliberately not one of those: it leaves
   * the panes on screen, so the keys that drive them must keep working — Space while you watch a
   * level on the I/O tab is the whole point of that tab not being a dialog over the thing it
   * meters. Typing is safe either way, the guard below being about the FOCUSED element rather
   * than about which screen is open.
   */
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
      // Two different reasons to stand aside, and only one of them holds for Space.
      //
      // TYPING — a field or a code editor — owns every key it is given, Space included; that is
      // what makes it a text editor. Nothing here may touch it.
      //
      // A CONTROL with focus (a button, a link, a select) is a different case: it keeps the keys
      // the platform gives it, but two of them come back here.
      //
      // Space, because it has to be the transport wherever the last click landed — a button
      // reached by pointer keeps focus, and "Space plays" failing because you had just clicked
      // Mute is the bug this rule exists to kill. Escape, because a focused button does nothing
      // with it at all, and Esc's first job is to close the overlay that button is sitting in.
      // Enter still activates the button, so a control tabbed to is still reachable from the
      // keyboard. Every other key still belongs to the control — `blurOnClick` (keys.ts) is what
      // hands those back after a mouse click.
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
        // What comes back from a focused control is the TRANSPORT's keys — wherever the person
        // has put them, so a remapped play key keeps the promise Space's default had — plus
        // Escape. Enter stays the control's even though its default is transport rewind: it
        // activates the button, which is what keeps a Tab-focused control operable.
        const t = keyToken(e);
        const passes =
          t === "esc" ||
          (t !== null &&
            t !== "enter" &&
            !!effKeys[t]?.startsWith("transport "));
        if (!passes) return;
      }
      // The command entry: two lone Shift presses within DOUBLE_SHIFT_MS, `e.repeat` filtering a
      // held Shift. What that OPENS is the host's — the shell's docked bar or its popin palette,
      // a surface's one line. (Never the other way: this branch is unreachable from inside any of
      // them, all being inputs.)
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
      // ⌃C with text actually SELECTED on the page is the browser's copy, and it is let through.
      //
      // The chord is this shell's otherwise (keys.ts's CHORDS), which is the whole reason the
      // exception has to be here: a log line, a status message or a refusal reads as text and
      // copying it is what a person means by ⌃C over it. A grid's rectangle is not a DOM
      // selection at all — the timeline's lanes are `select-none` and the roll's drags
      // `preventDefault` — so the two cannot be confused, and the app's own copy is unaffected.
      if (token === "ctrl+c") {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.toString().trim()) return;
      }
      // Through the person's own keymap: their assignments and steals first, the app's
      // conditional bindings (esc, f, m…) as the fallback — see keys.ts's resolveToken.
      const command = resolveToken(token, conditions, effKeys);
      if (!command) return;
      e.preventDefault();
      void runCommand(command);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, conditions, effKeys, runCommand, onDoubleShift]);
}
