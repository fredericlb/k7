// nodeUIs.ts — the panels the graph draws for its BUILT-IN cards: a lane's strip, the sums and the
// main out, a rack's pads, a live input, a camera, a MIDI input. They are generated here, not read
// from a module's ui.yaml, because no module file stands behind them. See docs/bindings.md.

import type {
  WebChainStep,
  WebModuleUI,
  WebRackSound,
  WebWidget,
} from "@studio/graph-model";
import { panelWidgets } from "@studio/graph-model/panel";
import {
  INPUT_VOLUME_PARAM,
  MIX_PARAM,
  OUTPUT_VOLUME_PARAM,
  VOLUME_RANGE,
} from "@studio/song-schema/moduleTypes";
import {
  RACK_ADD_BIND,
  RACK_BIND,
  rackAddBind,
  rackAddBindAt,
  rackBindSymbol,
} from "@studio/song-schema/yaml/moduleSchema";

// The built-in UI every TRACK node carries — five mixer controls on `@` binds. See docs/graphBuild.md.
export const TRACK_UI: WebModuleUI = {
  cols: 3,
  rows: 2,
  widgets: {
    // The three latching buttons share the top row, with the knobs beneath.
    mute: { type: "button", col: 0, row: 0, bind: "@mute", label: "M" },
    solo: { type: "button", col: 1, row: 0, bind: "@solo", label: "S" },
    arm: { type: "button", col: 2, row: 0, bind: "@arm", label: "A" },
    // max 6, not 12: the engine's fader clamps at +6 dB, so a taller knob promised gain it could not deliver.
    vol: {
      type: "knob",
      col: 0,
      row: 1,
      bind: OUTPUT_VOLUME_PARAM,
      label: "vol",
      min: -60,
      max: 6,
    },
    pan: {
      type: "knob",
      col: 1,
      row: 1,
      bind: "@pan",
      label: "pan",
      min: 0,
      max: 1,
    },
  },
};

/** …and the MAIN OUTPUT's: the song's output level on an ORDINARY bind. See @studio/song's docs/masterVolume.md. */
/** The bind prefix a PROJECT setting carries: `@project:aspect` FIRES `project aspect <value>` (apps/k7/frontend/docs/picture.md). */
export const PROJECT_BIND = "@project:";

/** The project setting a bind names, or null for any other bind. */
export const projectBindField = (bind: string | undefined): string | null => {
  if (!bind?.startsWith(PROJECT_BIND)) return null;
  const field = bind.slice(PROJECT_BIND.length);
  return field.length ? field : null;
};

/** What the RENDER card carries: the FRAME's shape, song-schema's `ASPECTS` spelled again (apps/k7/frontend/docs/picture.md). */
export const RENDER_UI: WebModuleUI = {
  cols: 2,
  rows: 1,
  widgets: {
    aspect: {
      type: "dropdown",
      col: 0,
      row: 0,
      colSpan: 2,
      bind: "@project:aspect",
      label: "frame",
      options: [
        { label: "16:9", value: 0 },
        { label: "9:16", value: 1 },
      ],
    },
  },
};

export const MAIN_OUT_UI: WebModuleUI = {
  cols: 1,
  rows: 2,
  widgets: {
    vol: {
      type: "fader",
      col: 0,
      row: 0,
      rowSpan: 2,
      bind: "Volume",
      label: "out",
      min: VOLUME_RANGE.min,
      max: VOLUME_RANGE.max,
      step: 0.5,
    },
  },
};

// The rack-pad binds are the file format's vocabulary, re-exported so a renderer imports one place. See `rackUI`.
export {
  INPUT_VOLUME_PARAM,
  MIX_PARAM,
  OUTPUT_VOLUME_PARAM,
  RACK_ADD_BIND,
  RACK_BIND,
  rackAddBind,
  rackAddBindAt,
  rackBindSymbol,
};

/** The bind prefix a RECORDER's controls carry: `@rec:record` fires, it does not set (packages/song/docs/recorderNode.md). */
export const REC_BIND = "@rec:";

/** What a recorder node can be told to do. `save` is the file service's; the other two the engine's. */
export const REC_VERBS = ["record", "clear", "save"] as const;
export type RecVerb = (typeof REC_VERBS)[number];

/** The verb a recorder bind names, or null for any other bind — an unknown one is NOT a verb. */
export const recBindVerb = (bind: string | undefined): RecVerb | null => {
  if (!bind?.startsWith(REC_BIND)) return null;
  const verb = bind.slice(REC_BIND.length);
  return (REC_VERBS as readonly string[]).includes(verb)
    ? (verb as RecVerb)
    : null;
};

/** The widest a pad grid gets — four, the shape a drum grid already has. */
const RACK_COLS = 4;
/** …and the smallest, so a one-sound rack still reads as a rack. See docs/graphBuild.md. */
const RACK_MIN = 2;

/** The shape a pad grid takes for `n` sounds: square-ish, never under 2×2, never over four wide. */
export function rackGrid(n: number): { cols: number; rows: number } {
  const cols = Math.max(
    RACK_MIN,
    Math.min(RACK_COLS, Math.ceil(Math.sqrt(Math.max(1, n)))),
  );
  return { cols, rows: Math.max(RACK_MIN, Math.ceil(Math.max(1, n) / cols)) };
}

/** A TAP's footprint in cells, 2×2 like a knob: the pad, and under it its note and its sample's name. */
export const TAP_COLS = 2;
export const TAP_ROWS = 2;
/** An octave's pads, four across and three up: twelve notes, the lowest at the bottom left as on a pad controller. */
export const PADS_ACROSS = 4;
export const PADS_UP = 3;
/** The rack's first note with nothing on it yet — song-edit's rackTaps.ts starts there too. */
const FIRST_RACK_NOTE = 36;

/** An SFZ kit's level, the SFZ player's own trim, and its range in dB — engine/k7-runtime/engine/SfzPlugin.cpp. */
const KIT_VOLUME = { bind: "Volume", min: -40, max: 12 } as const;
/** …and one pad's, the player's gain on that pad's KEY, in whole dB — the same file. */
const KIT_PAD_GAIN = { min: -24, max: 12, step: 1 } as const;

/** An octave's tab name, by its C — `C2` for note 36, the piano roll's numbering. */
export const octaveName = (octave: number): string => `C${octave - 1}`;

/** The UI a RACK node carries: a tab per octave, each a 4×3 grid of its notes — a pad, or an empty cell that adds one. See docs/racks.md. */
export function rackUI(
  rack: readonly WebRackSound[],
  fixed = false,
): WebModuleUI {
  // A kit's pad has a row more, under it: its gain, the one thing about a kit's pad that is the node's to set.
  const padRows = fixed ? TAP_ROWS + 1 : TAP_ROWS;
  const byNote = new Map<number, WebRackSound>();
  // Two sounds on one note share its cell, and the first written is the one drawn.
  for (const s of rack) if (!byNote.has(s.note)) byNote.set(s.note, s);
  const used = [...new Set(rack.map((s) => Math.floor(s.note / 12)))].sort(
    (a, b) => a - b,
  );
  // A rack that takes new pads also offers the octave over its highest, or where an empty one starts.
  const octaves = fixed
    ? used
    : used.length
      ? [...new Set([...used, Math.min(10, used[used.length - 1] + 1)])]
      : [Math.floor(FIRST_RACK_NOTE / 12)];
  const cell = (note: number) => {
    const i = note % 12;
    return {
      col: (i % PADS_ACROSS) * TAP_COLS,
      row: (PADS_UP - 1 - Math.floor(i / PADS_ACROSS)) * padRows,
    };
  };
  const tabs = octaves.map((o) => {
    const widgets: Record<string, WebWidget> = {};
    for (let note = o * 12; note < o * 12 + 12 && note <= 127; note++) {
      const at = cell(note);
      const s = byNote.get(note);
      if (s) {
        widgets[`rack:${s.symbol}`] = {
          type: "tap",
          ...at,
          colSpan: TAP_COLS,
          rowSpan: TAP_ROWS,
          bind: `${RACK_BIND}${s.symbol}`,
          label: s.symbol,
        };
        if (fixed)
          widgets[`kit:gain:${s.symbol}`] = {
            type: "number",
            col: at.col,
            row: at.row + TAP_ROWS,
            colSpan: TAP_COLS,
            rowSpan: 1,
            bind: `Key ${s.note}`,
            label: "dB",
            ...KIT_PAD_GAIN,
          };
      } else if (!fixed)
        widgets[`rack+:${note}`] = {
          type: "tap",
          ...at,
          colSpan: TAP_COLS,
          rowSpan: TAP_ROWS,
          bind: rackAddBindAt(note),
        };
    }
    return { name: octaveName(o), widgets };
  });
  const gridCols = PADS_ACROSS * TAP_COLS;
  // A kit's level is drawn on every tab, in a column of its own right of the pads.
  const widgets: Record<string, WebWidget> = fixed
    ? {
        "kit:volume": {
          type: "knob",
          col: gridCols,
          row: 0,
          colSpan: TAP_COLS,
          rowSpan: TAP_ROWS,
          label: "Volume",
          ...KIT_VOLUME,
        },
      }
    : {};
  const cols = gridCols + (fixed ? TAP_COLS : 0);
  const rows = PADS_UP * padRows;
  // One octave is one page: a single tab draws no tab column.
  if (tabs.length === 1)
    return { cols, rows, widgets: { ...widgets, ...tabs[0].widgets } };
  return { cols, rows, widgets, tabs };
}

/** The UI a live INPUT node carries: its socket, its width, its monitoring. See docs/graphBuild.md. */
export function inputUI(
  devices: readonly { name: string; channels: number[] }[],
  channel: readonly number[] | undefined,
): WebModuleUI {
  const stereo = channel?.length === 2;
  const first = channel?.[0] ?? 1;
  // The socket list offers the CURRENT width; the other width is the question the control beside it asks.
  const sets = devices.filter((d) => d.channels.length === (stereo ? 2 : 1));
  // Width writes `channel:` too, and a pair is even/odd — the interface groups no other way.
  const odd = first % 2 === 1 ? first : first - 1;
  const widgets: Record<string, WebWidget> = {
    // `value` is a position in the list and nothing more: the channels travel in `arg`.
    channel: {
      type: "dropdown",
      col: 0,
      row: 0,
      colSpan: 2,
      bind: "@channel",
      label: "in",
      options: sets.map((d, i) => ({
        label: d.name,
        value: i,
        arg: d.channels.join(","),
      })),
    },
    width: {
      type: "dropdown",
      col: 0,
      row: 1,
      bind: "@channel",
      label: "width",
      options: [
        { label: "mono", value: 0, arg: String(first) },
        { label: "stereo", value: 1, arg: `${odd},${odd + 1}` },
      ],
    },
    monitor: {
      type: "dropdown",
      col: 1,
      row: 1,
      bind: "@monitor",
      label: "mon",
      options: [
        { label: "off", value: 0 },
        { label: "auto", value: 1 },
        { label: "on", value: 2 },
      ],
    },
  };
  return { cols: 2, rows: 2, widgets };
}

/** Fill in a folder-backed dropdown's options — `none` first, then the names. See docs/graphBuild.md. */
function withFolderOptions(
  ui: WebModuleUI,
  bind: string,
  names: readonly string[] | undefined,
): WebModuleUI {
  const binds = panelWidgets(ui).some(([, w]) => w.bind === bind);
  if (!binds) return ui;
  const options = [
    { label: "none", value: 0 },
    ...(names ?? []).map((b, i) => ({ label: b, value: i + 1 })),
  ];
  // On every tab, since a dropdown on a closed one is still the module's.
  const fill = (ws: Record<string, WebWidget>): Record<string, WebWidget> =>
    Object.fromEntries(
      Object.entries(ws).map(([id, w]) => [
        id,
        w.bind === bind ? { ...w, options } : w,
      ]),
    );
  return {
    ...ui,
    widgets: fill(ui.widgets ?? {}),
    ...(ui.tabs
      ? { tabs: ui.tabs.map((t) => ({ ...t, widgets: fill(t.widgets) })) }
      : {}),
  };
}

/** The binds a folder-backed dropdown carries — each intrinsic's name, verbatim, as every bind is. */
const BASE_BIND = "@base";
/** …and the shader's, the same mechanism over a different folder. See @studio/song's docs/shaders.md. */
const SHADER_BIND = "@shader";

/** The intrinsic a camera's dropdown writes — `node param <node> @camera <label>`. */
export const CAMERA_BIND = "@camera";

/** The UI a CAMERA node carries, synthesised since `@meta/CAM` has no ui.yaml: one dropdown of the browser's lenses. */
export function cameraUI(
  cameras: readonly string[],
  current: string | undefined,
): WebModuleUI {
  // "default" first and always, so a chosen lens can be un-chosen — `@base`'s `none` again.
  const options = [
    { label: "default", value: 0, arg: "default" },
    ...cameras.map((name, i) => ({ label: name, value: i + 1, arg: name })),
  ];
  // `current` is the RENDERER's to read off the step: a selected index here would be a second answer.
  void current;
  return {
    cols: 2,
    rows: 2,
    widgets: {
      camera: {
        type: "dropdown",
        col: 0,
        row: 0,
        colSpan: 2,
        bind: CAMERA_BIND,
        label: "cam",
        options,
      },
      // A lens gets the input's own three words, meaning SHOWN rather than heard (docs/camera.md).
      monitor: {
        type: "dropdown",
        col: 0,
        row: 1,
        colSpan: 2,
        bind: "@monitor",
        label: "mon",
        options: [
          { label: "off", value: 0 },
          { label: "auto", value: 1 },
          { label: "on", value: 2 },
        ],
      },
    },
  };
}

/** The intrinsic a MIDI device's dropdown writes — `node param <node> @device <label>`. */
export const DEVICE_BIND = "@device";

/** The UI a MIDI-IN node carries, synthesised like `cameraUI`'s: the browser's MIDI inputs — @studio/song's docs/midiIn.md. */
export function midiInUI(devices: readonly string[]): WebModuleUI {
  // "any" first and always, so a chosen device can be un-chosen without editing the file.
  const options = [
    { label: "any", value: 0, arg: "any" },
    ...devices.map((name, i) => ({ label: name, value: i + 1, arg: name })),
  ];
  return {
    cols: 3,
    rows: 1,
    widgets: {
      device: {
        type: "dropdown",
        col: 0,
        row: 0,
        colSpan: 3,
        bind: DEVICE_BIND,
        label: "device",
        options,
      },
    },
  };
}

/** The panel a step actually draws — one function, so the node's SIZE and its `ui` cannot disagree. */
export function stepUI(
  s: WebChainStep,
  devices: readonly { name: string; channels: number[] }[] | undefined,
  cameras: readonly string[] | undefined,
  midiDevices: readonly string[] | undefined,
): WebModuleUI | undefined {
  // The folder lists fold into whichever panel is drawn, authored or synthesised, and in one place.
  if (s.ui)
    return withFolderOptions(
      withFolderOptions(s.ui, BASE_BIND, s.bases),
      SHADER_BIND,
      s.shaders,
    );
  // Present, even EMPTY: a kit node is born with no sounds, and its "+" is how it gets one.
  if (s.rack) return rackUI(s.rack, !!s.rackKit);
  // A LENS is told apart the way a live input is: by the field only its own kind carries.
  if (s.camera !== undefined) return cameraUI(cameras ?? [], s.camera);
  // …and a MIDI device the same way, by `device`, which only a midi-in step carries.
  if (s.device !== undefined) return midiInUI(midiDevices ?? []);
  return s.monitor !== undefined
    ? inputUI(devices ?? [], s.channel)
    : undefined;
}

// A VIDEO lane's strip: mute (hidden) and solo, the two words picture HAS — no gain, no pan, no arm.
export const VIDEO_TRACK_UI: WebModuleUI = {
  cols: 2,
  rows: 1,
  widgets: {
    mute: { type: "button", col: 0, row: 0, bind: "@mute", label: "M" },
    solo: { type: "button", col: 1, row: 0, bind: "@solo", label: "S" },
  },
};
