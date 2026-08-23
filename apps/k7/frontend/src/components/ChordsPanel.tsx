import { useEffect, useRef } from "react";
import { ChordDiagram } from "./ChordDiagram";

interface Props {
  chords: string[];
  selected: string | null;
  open: boolean;
  onToggle: () => void;
}

/** A desktop-only panel on the right margin, listing every chord with its diagrams. */
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
      className={`chords-panel${open ? "" : " collapsed"}${chords.length > 6 ? " three-col" : ""}`}
    >
      <button
        className="chords-panel-toggle"
        onClick={onToggle}
        aria-expanded={open}
      >
        🎸 Chords{open ? " ›" : " ‹"}
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
