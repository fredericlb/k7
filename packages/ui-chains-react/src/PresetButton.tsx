// PresetButton.tsx — the node's one dropdown on the header's second line: its ENGINE and its PRESET.
// Only the button: the list is a popup the HOST draws at the point this reports — its presets, and a
// left bar of the engines when the module runs as more than one — since what a preset is, where it is
// kept and which engines exist are the host's. Its width is SET, so the line is known without a reflow.
// See packages/song/docs/userPresets.md and packages/song/docs/engines.md.

import { ChevronDown } from "@frediverse/ui/icons";

/** The engines a node can run as, and which it does — handed to the host's popup with the click. */
export interface NodeEngines {
  names: string[];
  current: string;
}

/** The button's width without an engine: room for a short preset name and the arrow. */
export const PRESET_BUTTON_W = 70;
// One character of the 9 px monospace, the gap after the engine, and the most the engine part takes.
const ENGINE_CHAR_W = 5.5;
const ENGINE_GAP_W = 6;
const ENGINE_MAX_W = 60;

/** The button's width: the preset's room, and the longest engine name's when there is a choice of engines. */
export function presetButtonW(engines?: NodeEngines): number {
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
}: {
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
}) {
  const title = [
    engines ? `Engine — ${engines.current}` : null,
    current ? `Preset — ${current}` : "Presets of this module",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    // Kept off the pane like a widget's press, or it arms a pan and the click never lands.
    <button
      type="button"
      className={`dgx-engine dgx-preset${current ? " on" : ""}`}
      style={{ width: presetButtonW(engines) }}
      title={title}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        onPresets(module, r.left, r.bottom + 2, engines);
      }}
    >
      {engines && <b className="dgx-preset-eng">{engines.current}</b>}
      <span>{current ?? "preset"}</span>
      <ChevronDown />
    </button>
  );
}
