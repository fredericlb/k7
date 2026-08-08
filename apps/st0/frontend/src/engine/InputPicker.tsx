// InputPicker.tsx — the little menu the `in` node opens: which interface input feeds the
// module being auditioned. Placed at the click, like the asset browser in l8, because it
// belongs to the node it came from. See ../../docs/modulePreview.md.

import { useEffect, useRef } from "react";
import { meterFill } from "./InputMeter";
import type { InputChoice } from "./inputChannels";

export function InputPicker({
  at,
  choices,
  current,
  levels,
  onPick,
  onClose,
}: {
  /** Viewport coords of the click that opened it. */
  at: { x: number; y: number };
  choices: InputChoice[];
  /** The channels currently feeding the preview, so the row can be marked. */
  current: number[];
  /**
   * What each set is doing RIGHT NOW, in dB, keyed `"1"` / `"1+2"`.
   *
   * The point of the whole menu: an interface has twenty inputs and your guitar is on one of
   * them, and reading the labels tells you nothing about which. Play a note and the row moves.
   */
  levels: Record<string, number>;
  onPick: (channels: number[]) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);

  // Escape and a click outside. Both, because the two are the same gesture — "not this" — and
  // a menu that only one of them closes is one you end up clicking twice to be rid of.
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const down = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", key);
    // Capture, so a click on the graph closes this before the pane treats it as a pan.
    window.addEventListener("mousedown", down, true);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("mousedown", down, true);
    };
  }, [onClose]);

  const same = (c: InputChoice) => c.channels.join("+") === current.join("+");

  return (
    <div
      ref={box}
      className="fixed z-50 max-h-72 w-56 overflow-auto rounded-md border border-border bg-popover p-1 shadow-lg"
      // Clamped to the viewport: the node can sit near the bottom of a 30%-tall preview box,
      // and a menu opening off-screen there is one you cannot reach.
      style={{
        left: Math.min(at.x, window.innerWidth - 232),
        top: Math.min(at.y, window.innerHeight - 300),
      }}
    >
      <div className="px-2 py-1 text-xs text-muted-foreground">
        Entrée de l'interface
      </div>
      {choices.map((c) => (
        <button
          key={`${c.label}:${c.channels.join("+")}`}
          type="button"
          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent ${
            same(c) ? "bg-accent" : ""
          }`}
          onClick={() => {
            onPick(c.channels);
            onClose();
          }}
        >
          <span className="min-w-0 flex-1 truncate">{c.label}</span>
          {/* What it is doing, right now. Play a note and the row moves — which is the only
              way to tell twenty identically-named inputs apart. */}
          {c.channels.length > 0 && (
            <span className="relative block h-1 w-10 shrink-0 overflow-hidden rounded-full bg-muted">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-primary"
                style={{
                  width: `${meterFill(levels[c.channels.join("+")] ?? -100) * 100}%`,
                }}
              />
            </span>
          )}
          {/* The channel numbers beside the name: a label says what it is plugged into, the
              number says where, and troubleshooting a silent input needs the second. */}
          {c.channels.length > 0 && (
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {c.channels.join("+")}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
