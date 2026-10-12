import { Guitar } from "@frediverse/ui/icons";
import { useEffect, useRef } from "react";
import { m } from "../paraglide/messages.js";
import { ChordDiagram } from "./ChordDiagram";

interface Props {
  chords: string[];
  selected: string | null;
  open: boolean;
  onToggle: () => void;
}

/** A panel of the page's right rail, listing every chord with its diagrams. Desktop only. */
export function ChordsPanel({ chords, selected, open, onToggle }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll the selected chord (clicked in the sheet) into view within the panel.
  useEffect(() => {
    if (!selected || !open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-chord="${CSS.escape(selected)}"]`,
    );
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected, open]);

  return (
    <aside
      className={`rail-panel chords-panel${open ? "" : " collapsed"}${chords.length > 6 ? " three-col" : ""}`}
    >
      <button
        type="button"
        className="rail-panel-toggle"
        onClick={onToggle}
        aria-expanded={open}
      >
        <Guitar className="size-4" />
        <span className="rail-panel-word">{m["panel.chords"]()}</span>
      </button>
      {open && (
        <div className="chords-panel-list" ref={listRef}>
          {chords.map((c) => (
            <div
              key={c}
              data-chord={c}
              className={`chords-panel-item${c === selected ? " selected" : ""}`}
            >
              <ChordDiagram symbol={c} />
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
