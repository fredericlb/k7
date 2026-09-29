// ValueEditor.tsx — the text field a control becomes when a value is to be TYPED: a double-clicked
// knob, a tap's note. Enter or leaving it commits, Escape does not; it reports once, whichever way
// it is left. See docs/widgets.md.

import { useRef } from "react";

/** The text field a double-clicked control becomes: Enter or leaving it commits, Escape does not. */
export function ValueEditor({
  initial,
  onDone,
}: {
  initial: number | undefined;
  /** The text typed, or null for "never mind". Called ONCE, whichever way the field is left. */
  onDone: (text: string | null) => void;
}) {
  const done = useRef(false);
  const finish = (text: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(text);
  };
  return (
    <input
      className="dgx-wedit"
      // Four decimals and no trailing zeros: the value as it is, not as the knob rounds it for display.
      defaultValue={
        initial === undefined ? "" : String(Number(initial.toFixed(4)))
      }
      // biome-ignore lint/a11y/noAutofocus: the field exists only because a double-click asked for it.
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      // Kept off the pane and the control under it: a press here is a caret, not a drag.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}
