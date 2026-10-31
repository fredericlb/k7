// PresetButton.tsx — the node's one dropdown on the header's second line: its ENGINE and its PRESET.
// Only the button: the list is a popup the HOST draws at the point this reports — its presets, and a
// left bar of the engines when the module runs as more than one — since what a preset is, where it is
// kept and which engines exist are the host's. Its LEAST width is set; it grows into the line, to 300 px.
// See packages/song/docs/userPresets.md and packages/song/docs/engines.md.

import { ChevronDown, ChevronLeft, ChevronRight } from "@frediverse/ui/icons";
import { type ChainsLabels, ENGLISH_CHAINS_LABELS } from "./labels";

/** The engines a node can run as, and which it does — handed to the host's popup with the click. */
export interface NodeEngines {
  names: string[];
  current: string;
}

/** The button's width without an engine: room for a short preset name and the arrow. */
const PRESET_BUTTON_W = 70;
// One character of the 9 px monospace, the gap after the engine, and the most the engine part takes.
const ENGINE_CHAR_W = 5.5;
const ENGINE_GAP_W = 6;
const ENGINE_MAX_W = 60;

/** The button's least width: the preset's room, and the longest engine name's when there is a choice of engines. */
function presetButtonW(engines?: NodeEngines): number {
  if (!engines) return PRESET_BUTTON_W;
  const longest = Math.max(0, ...engines.names.map((n) => n.length));
  return (
    PRESET_BUTTON_W +
    Math.min(ENGINE_MAX_W, Math.ceil(longest * ENGINE_CHAR_W) + ENGINE_GAP_W)
  );
}

export function PresetButton({
  module,
  current,
  engines,
  onPresets,
  onStep,
  l = ENGLISH_CHAINS_LABELS,
}: {
  /** The words, handed down by the card: the button is called as a function in tests, so it reads no context. */
  l?: ChainsLabels;
  module: string;
  /** The preset last loaded on this node in this session, if any. */
  current?: string;
  /** Present only when the module runs as more than one engine and the host can switch them. */
  engines?: NodeEngines;
  onPresets: (
    module: string,
    x: number,
    y: number,
    engines?: NodeEngines,
  ) => void;
  /** The arrows after the dropdown: load the previous (-1) or next (+1) preset — drawn only when given. */
  onStep?: (module: string, step: -1 | 1) => void;
}) {
  const title = [
    engines ? l.engineNamed(engines.current) : null,
    current ? l.presetNamed(current) : l.presetsOfModule,
  ]
    .filter(Boolean)
    .join("\n");
  // An arrow is a button of its own, kept off the pane like the dropdown, which loads a preset at once.
  const arrow = (step: -1 | 1) => (
    <button
      type="button"
      className="dgx-engine dgx-preset-step"
      title={step < 0 ? l.previousPreset : l.nextPreset}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onStep?.(module, step);
      }}
    >
      {step < 0 ? <ChevronLeft /> : <ChevronRight />}
    </button>
  );
  return (
    <>
      {/* Kept off the pane like a widget's press, or it arms a pan and the click never lands. */}
      <button
        type="button"
        className={`dgx-engine dgx-preset${current ? " on" : ""}`}
        style={{ minWidth: presetButtonW(engines) }}
        title={title}
        // Named after the preset it holds, so a screen reader hears what is loaded; the title is its description.
        aria-label={current ? l.presetLoaded(current) : l.preset}
        aria-haspopup="menu"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          onPresets(module, r.left, r.bottom + 2, engines);
        }}
      >
        {engines && <b className="dgx-preset-eng">{engines.current}</b>}
        <span>{current ?? l.preset}</span>
        <ChevronDown />
      </button>
      {onStep && arrow(-1)}
      {onStep && arrow(1)}
    </>
  );
}
