// widgetKinds.ts — what the grid editor knows about each widget KIND: its palette entry, whether it
// binds a param or carries a range, and which fields survive a change of type. Shared by the grid
// and its inspector. The one thing a reader would get wrong: retype CLEARS, it does not just set.

import {
  Activity,
  AudioWaveform,
  Circle,
  FileSearch,
  Group,
  Hash,
  List,
  type LucideIcon,
  Monitor,
  RectangleHorizontal,
  SlidersHorizontal,
  SlidersVertical,
  ToggleLeft,
  Type,
} from "@frediverse/ui/icons";
import type { Widget, WidgetType } from "./moduleUi";

export const TYPES: { type: WidgetType; icon: LucideIcon; label: string }[] = [
  { type: "knob", icon: Circle, label: "Knob" },
  { type: "slider", icon: SlidersHorizontal, label: "Slider" },
  { type: "fader", icon: SlidersVertical, label: "Fader" },
  { type: "toggle", icon: ToggleLeft, label: "Toggle" },
  { type: "dropdown", icon: List, label: "Dropdown" },
  { type: "filepicker", icon: FileSearch, label: "File" },
  { type: "button", icon: RectangleHorizontal, label: "Button" },
  { type: "number", icon: Hash, label: "Number" },
  { type: "meter", icon: Activity, label: "Meter" },
  { type: "waveform", icon: AudioWaveform, label: "Waveform" },
  { type: "lcdscreen", icon: Monitor, label: "LCD screen" },
  { type: "label", icon: Type, label: "Label" },
  { type: "group", icon: Group, label: "Group" },
];

export const ICON: Record<WidgetType, LucideIcon> = Object.fromEntries(
  TYPES.map((t) => [t.type, t.icon]),
) as Record<WidgetType, LucideIcon>;

/** A fresh group's tint: the OP palette's blue, faint enough that the controls on it stay legible. */
export const GROUP_COLOR = "#3d7dff26";

// Which widget kinds carry a `bind`, and so the only ones a dragged parameter can bounce off.
export const bindable = (w: Pick<Widget, "type">) =>
  w.type !== "label" &&
  w.type !== "waveform" &&
  w.type !== "lcdscreen" &&
  w.type !== "group";

// …and which carry a RANGE. Not a dropdown: it addresses its param by named setting, and its options are the set.
export const ranged = (w: Widget) =>
  w.type === "knob" ||
  w.type === "slider" ||
  w.type === "fader" ||
  w.type === "number";

// Changing type must CLEAR the fields the new type lacks: a leftover fails validation and takes the graph down.

// Returns the type plus explicit undefineds; the caller merges, and writeUi drops undefined fields.
export function retype(w: Widget, type: WidgetType): Partial<Widget> {
  const next: Widget = { ...w, type };
  return {
    type,
    text: type === "label" ? w.text : undefined,
    bind: bindable(next) ? w.bind : undefined,
    min: ranged(next) ? w.min : undefined,
    max: ranged(next) ? w.max : undefined,
    step: ranged(next) ? w.step : undefined,
    curve: ranged(next) ? w.curve : undefined,
    source: type === "waveform" ? w.source : undefined,
    options: type === "dropdown" ? w.options : undefined,
    library: type === "dropdown" ? w.library : undefined,
    color: type === "group" ? (w.color ?? GROUP_COLOR) : undefined,
    pair: type === "knob" ? w.pair : undefined,
  };
}
