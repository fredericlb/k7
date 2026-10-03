// PresetButton.tsx — the node's PRESET dropdown, right of the engine select on the header's second
// line. Only the button: the list is a searchable popup the HOST draws at the point this reports,
// as for an asset, since what a preset is and where it is kept are the host's. Its width is SET,
// so the line's layout is known without a reflow. See packages/song/docs/userPresets.md.

import { ChevronDown } from "@frediverse/ui/icons";

/** The button's width: room for a short name and the arrow, the most a header gives up. */
export const PRESET_BUTTON_W = 70;

export function PresetButton({
  module,
  current,
  onPresets,
}: {
  module: string;
  /** The preset last loaded on this node in this session, if any. */
  current?: string;
  onPresets: (module: string, x: number, y: number) => void;
}) {
  return (
    // Kept off the pane like a widget's press, or it arms a pan and the click never lands.
    <button
      type="button"
      className={`dgx-engine dgx-preset${current ? " on" : ""}`}
      style={{ width: PRESET_BUTTON_W }}
      title={current ? `Preset — ${current}` : "Presets of this module"}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        onPresets(module, r.left, r.bottom + 2);
      }}
    >
      <span>{current ?? "preset"}</span>
      <ChevronDown />
    </button>
  );
}
