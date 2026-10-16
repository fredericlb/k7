// moduleSchema.ts — a module file's shape, in Zod. The single, authoritative schema
// (no second generated copy to drift from it). Deliberately does NOT check reference
// fields (`extends`, a rack's `clip`) — those need the rest of the project and live in
// TS (graph.ts validate(), nodeProject's ref pass) instead.

import { z } from "zod";
import { ENGINE_NAME } from "../engines";
import { MODULE_STATUSES, SHAPE_KINDS } from "../moduleTypes";
import { PlacementSchema } from "./placementSchema";

/** An interface input: a preferences label, or one/two physical channel numbers. */
export const InputSchema = z.union([
  z.string().min(1),
  z.tuple([z.number().int().positive()]),
  z.tuple([z.number().int().positive(), z.number().int().positive()]),
]);

/** One rack sound — a TAP: the note it answers to, plus a library `sample`, or the older clip or [from,to) window. */
export const RackSoundSchema = z.object({
  note: z.number().int().min(0).max(127),
  // `@<library>/<path>` under a library's `samples/` — where every sample lives (packages/song/docs/libraryFiles.md).
  sample: z.string().min(1).optional(),
  clip: z.string().min(1).optional(),
  from: z.number().min(0).optional(),
  to: z.number().positive().optional(),
  // Silenced: kept on the kit and drawn, never handed to the sampler (packages/song/docs/racks.md).
  mute: z.boolean().optional(),
});

// The rack's two flavours by `rack_type`: a discriminated union gives the better error for the flavour asked for.
const SamplesRack = z.object({
  rack_type: z.literal("samples").default("samples"),
  symbols: z.record(
    z.string(),
    // A tap may be written before its sample is picked: an empty one plays nothing and says so on its card.
    RackSoundSchema,
  ),
});
const SliceRack = z.object({
  rack_type: z.literal("slice"),
  source: z.string().min(1),
  symbols: z.record(
    z.string(),
    RackSoundSchema.extend({
      from: z.number().min(0),
      to: z.number().positive(),
    }),
  ),
});
export const RackSchema = z.union([SliceRack, SamplesRack]);

/** One named port a module declares for itself; `mandatory` is an INPUT's business — see docs/moduleFile.md. */
export const PortSchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(["audio", "midi", "video"]),
    mandatory: z.boolean().optional(),
  })
  .strict();

/** What a waveform widget draws: the live signal either side of the module, or the recorder
 *  node's own TAKE — its whole picture, growing (engine/k7-runtime/docs/recorder.md). */
export const WAVEFORM_SOURCES = ["input", "output", "take"] as const;

/** Every `io:` a module may declare. Named for WAVEFORM_SOURCES' reason: `fields.ts` offers it. */
export const IO_KINDS = [
  "out",
  "in",
  "video_out",
  "file",
  "camera",
  "midi",
] as const;

export const WIDGET_TYPES = [
  "label",
  "knob",
  "slider",
  // A mixer strip's fader: vertical, and it fills the height its rowSpan gives it (docs/moduleFile.md).
  "fader",
  "number",
  "toggle",
  "button",
  "meter",
  "waveform",
  "dropdown",
  // Picks a FILE the module carries for a file-valued param (`bind: nam`) — see docs/filePicker.md.
  "filepicker",
  // A screen the module's WIDGETS_SCRIPT draws, looked up by the widget's id; it binds nothing.
  "lcdscreen",
  // One sound of a rack — a pad, its note and its library sample — bound `@rack:<symbol>` (packages/song/docs/racks.md).
  "tap",
  // A coloured frame under the widgets that lie wholly inside it, optionally switched by an on/off `bind` (docs/moduleFile.md).
  "group",
] as const;

/** The bind prefix a rack pad carries: `@rack:BD` fires the sound `BD` (packages/song/docs/racks.md). */
export const RACK_BIND = "@rack:";

/** The bind of a rack's LAST tap, which adds a sound rather than playing one. */
export const RACK_ADD_BIND = "@rack+";

/** An add tap on ONE note — an empty cell of a rack's octave grid: `@rack+<note>`. */
export const rackAddBindAt = (note: number): string =>
  `${RACK_ADD_BIND}${note}`;

/** Whether a bind is an add tap, and the note it adds on — null for a bare `@rack+`, which picks the note itself. */
export function rackAddBind(
  bind: string | undefined,
): { note: number | null } | null {
  if (!bind?.startsWith(RACK_ADD_BIND)) return null;
  const rest = bind.slice(RACK_ADD_BIND.length);
  if (!rest) return { note: null };
  const note = Number(rest);
  return Number.isInteger(note) && note >= 0 && note <= 127 ? { note } : null;
}

/** The symbol a rack-pad bind names, or null for any other bind. */
export const rackBindSymbol = (bind: string | undefined): string | null =>
  bind?.startsWith(RACK_BIND) ? bind.slice(RACK_BIND.length) : null;

/** The script beside `ui.yaml` that draws a panel's lcdscreen widgets — packages/ui-chains-react/docs/lcdScreen.md. */
export const WIDGETS_SCRIPT = "widgets.js";

// A refinement, not a union: a union would reject the half-second where the editor changed `type` but not the fields.
const WidgetBase = z.object({
  type: z.enum(WIDGET_TYPES),
  col: z.number().int().min(0),
  row: z.number().int().min(0),
  colSpan: z.number().int().positive().optional(),
  rowSpan: z.number().int().positive().optional(),
  label: z.string().optional(),
  hidden: z.boolean().optional(),
  text: z.string().optional(), // label
  bind: z.string().min(1).optional(),
  min: z.number().optional(), // knob | slider | number
  max: z.number().optional(),
  step: z.number().positive().optional(),
  curve: z.enum(["lin", "log"]).optional(),
  source: z.enum(WAVEFORM_SOURCES).optional(), // waveform
  options: z
    .array(z.object({ label: z.string(), value: z.number() }))
    .optional(), // dropdown
  library: z.string().optional(), // dropdown, from the project's asset library
  color: z
    .string()
    .regex(
      /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
      "a #rgb, #rrggbb or #rrggbbaa colour",
    )
    .optional(), // group
  invert: z.boolean().optional(), // group: its on/off bind is a mute or a bypass, on while the param is off
  pair: z.string().min(1).optional(), // knob: the DRY param of a crossfade knob, `bind` being the wet one
});

export type Widget = z.infer<typeof WidgetBase>;

const RANGED = new Set(["knob", "slider", "fader", "number"]);

export const WidgetSchema: z.ZodType<Widget> = WidgetBase.superRefine(
  (w, ctx) => {
    const wrong = (field: string, why: string) =>
      ctx.addIssue({
        code: "custom",
        path: [field],
        message: `\`${field}\` is not a ${w.type} field — ${why}`,
      });
    if (!RANGED.has(w.type))
      for (const f of ["min", "max", "step", "curve"] as const)
        if (w[f] !== undefined)
          wrong(f, "only knob, slider, fader and number carry a range");
    if (w.type !== "label" && w.text !== undefined)
      wrong("text", "only a label draws text");
    if (w.type === "lcdscreen" && w.bind !== undefined)
      wrong("bind", "an lcdscreen drives no param — widgets.js draws it");
    if (w.type !== "knob" && w.pair !== undefined)
      wrong("pair", "only a knob crossfades two params");
    if (w.pair !== undefined && (!w.bind || w.bind === w.pair))
      ctx.addIssue({
        code: "custom",
        path: ["pair"],
        message:
          "a crossfade knob binds the wet param and pairs a DIFFERENT, dry one",
      });
    if (w.type !== "group" && w.color !== undefined)
      wrong("color", "only a group paints a background");
    if (w.type !== "group" && w.invert !== undefined)
      wrong("invert", "only a group's on/off switch reads its param backwards");
    if (w.type !== "waveform" && w.source !== undefined)
      wrong("source", "only a waveform picks an audio tap");
    if (w.type !== "dropdown") {
      if (w.options !== undefined)
        wrong("options", "only a dropdown has settings");
      if (w.library !== undefined)
        wrong("library", "only a dropdown lists a library");
    }
    // A file picker with nothing to pick FOR cannot say what it would write — see docs/moduleFile.md.
    if (w.type === "filepicker" && !w.bind)
      ctx.addIssue({
        code: "custom",
        path: ["bind"],
        message:
          "a filepicker needs `bind` — the file-valued param it writes (e.g. bind: model)",
      });
  },
);

/** The longest a tab's name may be: it is drawn in a fixed column at the card's left (docs/moduleFile.md). */
export const TAB_NAME_MAX = 10;

/** One tab of a panel: a name and the widgets drawn while it is open. */
export const TabSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(TAB_NAME_MAX, `a tab name is at most ${TAB_NAME_MAX} characters`),
    widgets: z.record(z.string(), WidgetSchema),
  })
  .strict();

export type Tab = z.infer<typeof TabSchema>;

// The VERTICAL layout: the same controls and tabs laid out narrow (at most 4 columns), for a card read down — docs/moduleFile.md.
export const LayoutSchema = z
  .object({
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    widgets: z.record(z.string(), WidgetSchema),
    tabs: z.array(TabSchema).optional(),
  })
  .strict();

// `widgets` is drawn on every tab; `tabs`, in order, are the panel's pages — two or more are drawn as a column.
// The panel itself is the HORIZONTAL layout (at most 4 rows); `vertical` is its narrow twin, absent when the panel already fits both.
export const UISchema = z
  .object({
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    widgets: z.record(z.string(), WidgetSchema),
    tabs: z.array(TabSchema).optional(),
    vertical: LayoutSchema.optional(),
  })
  .superRefine((ui, ctx) => {
    const seen = new Set<string>();
    ui.tabs?.forEach((t, i) => {
      if (seen.has(t.name))
        ctx.addIssue({
          code: "custom",
          path: ["tabs", i, "name"],
          message: `two tabs are called "${t.name}"`,
        });
      seen.add(t.name);
    });
    // One panel in two shapes: the same pages, in the same order, or a switch of layout would land on another page.
    const names = (ui.tabs ?? []).map((t) => t.name).join("\u0000");
    const twin = (ui.vertical?.tabs ?? []).map((t) => t.name).join("\u0000");
    if (ui.vertical && names !== twin)
      ctx.addIssue({
        code: "custom",
        path: ["vertical", "tabs"],
        message:
          "the vertical layout must have the same tabs as the panel, in the same order",
      });
  });

/** A module's whole widget grid — what the visual editor reads and writes. */
export type ModuleUI = z.infer<typeof UISchema>;

// One `ui.yaml`: the panel beside a module's `module.yaml`, naming no module — the folder does (docs/moduleFile.md).
export const UiFileSchema = UISchema.strict();

export type UiFile = z.infer<typeof UiFileSchema>;

// One `controller.yaml`: which MIDI control moves which param, one control per param — see docs/controller.md.
export const CcBindingSchema = z
  .object({
    // 1..16 as a musician counts them, not 0..15 as the wire does — this file is read by people.
    ch: z.number().int().min(1).max(16),
    cc: z.number().int().min(0).max(127),
  })
  .strict();

export type CcBinding = z.infer<typeof CcBindingSchema>;

export const ControllerFileSchema = z.record(
  z.string().min(1),
  CcBindingSchema,
);

export type ControllerFile = z.infer<typeof ControllerFileSchema>;

/** The widget kinds, for a picker that must offer exactly what the schema accepts. */
export type WidgetType = Widget["type"];

/** A curve driving a named param; `trigger` names the module whose note-ons restart it — see docs/moduleFile.md. */
export const AutomationSchema = z
  .object({
    param: z.string().min(1),
    curve: z.string().min(1),
    trigger: z.string().min(1).optional(),
  })
  .strict();

/** Everything a module says about ITSELF, spread into both schemas below so an alternative gets it too — docs/moduleFile.md. */
const MODULE_FIELDS = {
  // Deliberately open — a plugin's shape is the ENGINE's business, matched as strings against its scan cache.
  plugin: z
    .looseObject({
      type: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  // "in" and "file" are SOURCES, the rest are sinks — see moduleTypes.IO_SOURCES, which the graph reads.
  io: z.enum(IO_KINDS).optional(),
  // The module's own PORTS, overriding the defaults its type folder gives — see docs/moduleFile.md.
  inputs: z.array(PortSchema).optional(),
  outputs: z.array(PortSchema).optional(),
  type: z
    .enum([
      "plugin",
      "rack",
      "video_effect",
      "video_transition",
      "shader",
      "shape",
    ])
    .optional(), // NOT .default() — the loader applies it (moduleFile.ts) so the file stays as terse as authored
  // Which SHADER this node runs — a bare folder name under the module's `shaders/`, see docs/moduleFile.md.
  shader: z
    .string()
    .min(1)
    .regex(
      /^[A-Za-z0-9_-]+$/,
      "a shader is a folder name in the module's shaders/ — letters, digits, '_' and '-'",
    )
    .optional(),
  // What a SHAPE module draws, its geometry being `params:` so a curve can drive it — see song-video/docs/shapes.md.
  shape: z.enum(SHAPE_KINDS).optional(),
  // …and, on a `text` shape, the CSS family its glyphs are set in; its string is `content:`, a doc note's key.
  font: z.string().optional(),
  // …how its lines sit in `w`, a box behind them, and a shadow under them — song-video docs/titles.md.
  align: z.enum(["left", "center", "right"]).optional(),
  background: z.string().optional(),
  shadow: z.boolean().optional(),
  // A param is a NUMBER, except the few the plugin steers with a file it loads — see docs/moduleAssets.md.
  params: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  // An empty `rack:` or `symbols:` is a kit stating no pads of its own — packages/song/docs/racks.md.
  rack: z
    .preprocess((v) => {
      const r = (v ?? {}) as Record<string, unknown>;
      return typeof r === "object" && r.symbols == null
        ? { ...r, symbols: {} }
        : r;
    }, RackSchema)
    .optional(),
  // Taps that leave by an output of their own, each feeding a SUBCHAIN of the node's chain file: tap → subchain id (packages/song/docs/racks.md).
  tap_outs: z
    .record(
      z
        .string()
        .regex(
          /^[A-Za-z0-9_-]+$/,
          "a tap's name: letters, digits, '_' and '-'",
        ),
      z.string().min(1),
    )
    .optional(),
  // An SFZ drum kit's PADS, each a name and the note the kit plays it on — drawn as taps (packages/song/docs/racks.md).
  kit: z
    .record(
      z
        .string()
        .regex(
          /^[A-Za-z0-9_-]+$/,
          "a pad's name: letters, digits, '_' and '-'",
        ),
      z.number().int().min(0).max(127),
    )
    .optional(),
  // A COLD module needs the whole of its input before it can produce any of it — see docs/coldModules.md.
  cold: z.boolean().optional(),
  // Where the MODEL a file-valued param names (`onnx:`, `nam:`) can be downloaded from, when this machine has not got
  // it — a URL, never a path. Inherited like any key; see packages/song/docs/moduleAssets.md.
  model_url: z
    .string()
    .regex(/^https?:\/\/\S+$/, "model_url is an http(s) URL")
    .optional(),
  // An io "in" module says WHICH interface input it is, and nothing about where the signal goes.
  channel: InputSchema.optional(),
  // …and an io "camera" module WHICH camera, by the LABEL a person reads: a deviceId is per
  // browser and rotates, so one written here names nothing anywhere else (docs/camera.md).
  camera: z.string().optional(),
  // …and an io "midi" module WHICH device it records from, by its label; "" or absent is any device (docs/midiIn.md).
  device: z.string().optional(),
  // …and WHERE in the viewport it draws, [x, y, w, h] in px. Absent is the whole frame. One key
  // rather than four, so it cannot be confused with graph.yaml's `positions:` — which is where a
  // node's CARD sits, a different fact about the same node (docs/camera.md).
  frame: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  // An io "file" module's audio FILE, project-relative, and ABSENT on a chain template — see docs/fileInput.md.
  source: z.string().optional(),
  // Whether you hear the input while it plays; the three-state spelling stays because "auto" is neither.
  monitor: z.union([z.boolean(), z.enum(["off", "auto", "on"])]).optional(),
  // Input trim in dB, applied at the interface before anything else sees the signal — see docs/moduleFile.md.
  gain: z.number().optional(),
  // The ENGINE's dry/wet around this effect, 0 all dry .. 1 all wet; absent is all wet (engine/k7-runtime/docs/mix.md).
  mix: z.number().min(0).max(1).optional(),
  // …and the engine's level into the module (an audio one) and out of it (anything with audio out), in dB.
  input_volume: z.number().min(-60).max(12).optional(),
  output_volume: z.number().min(-60).max(12).optional(),
  // Which named BASE this module starts from, with `params:` applied ON TOP of it — see docs/userPresets.md.
  base: z.string().optional(),
  ui: UISchema.optional(),
  automations: z.array(AutomationSchema).optional(), // curves driving this module's params
  // A NOTE on the graph — multiline free text, declared on the module so a node can override it (docs/docModules.md).
  content: z.string().optional(),

  // --- a LANE's own fields: accepted on any module, policed by graph.ts (see docs/trackModules.md) ---

  // The placements on this lane: what plays, where, and how many times — `events:`, not `clips:` (docs/moduleFile.md).
  events: z.array(PlacementSchema).optional(),
  // The lane's colour, and its icon's in the timeline.
  color: z.string().optional(),
  // Excluded from the render entirely, chains and all — distinct from bypassing it (docs/moduleFile.md).
  disabled: z.boolean().optional(),
  // A GROUP lane's members, by node name. It holds no material of its own.
  tracks: z.array(z.string()).optional(),
  // A GENERATED lane's pattern, standing where `events:` would — what it extends decides which it may write.
  strudel: z
    .string()
    .regex(/^algo\/.+\.strudel$/, "expected algo/<name>.strudel")
    .optional(),
  // A lane that PLAYS a picture lane's sound, its events derived from that lane's shots — packages/song/docs/videoSound.md.
  video_source: z.string().min(1).optional(),
  // A shader's 3D LUT, a `.cube` file, project-relative — the look a `uLut` pass reads (song-video docs/effects.md).
  lut: z
    .string()
    .regex(/\.cube$/i, "a LUT is a .cube file")
    .optional(),
  // FROZEN at this module: the render standing in for everything UPSTREAM of it — see docs/freeze.md.
  frozen: z.string().min(1).optional(),

  // Which of the module's `engines/` sub-folders it runs as — packages/song/docs/engines.md.
  engine: z
    .string()
    .regex(ENGINE_NAME, "an engine is a folder name in the module's engines/")
    .optional(),
  // …and the values set PER engine, so switching back finds the knobs as they were left.
  engines: z
    .record(
      z.string().regex(ENGINE_NAME),
      z
        .object({
          params: z
            .record(z.string(), z.union([z.number(), z.string()]))
            .optional(),
        })
        .strict(),
    )
    .optional(),
};

/** One ALTERNATIVE: the same flat struct a module is, minus the alternatives — docs/alternatives.md. */
export const AlternativeSchema = z
  .object({
    name: z.string().min(1).optional(),
    // A set naming its OWN module is another module entirely, not a patch over the node's (packages/song/docs/alternatives.md).
    extends: z.string().min(1).optional(),
    ...MODULE_FIELDS,
  })
  .strict();

export type Alternative = z.infer<typeof AlternativeSchema>;

export const ModuleSchema = z
  .object({
    extends: z.string().optional(),
    ...MODULE_FIELDS,
    // The module's other attribute SETS: its own fields are the first, and these are the ones after it.
    alternatives: z.array(AlternativeSchema).optional(),
    alternative: z
      .union([z.string().min(1), z.number().int().min(1)])
      .optional(),
    // How the COMPLETIONS should treat this module — one fact about it, said once (docs/moduleStatus.md).
    status: z.enum(MODULE_STATUSES).optional(),
  })
  .strict(); // an unknown key is a typo — silently ignoring `paramz:` is worse than saying so

export type Module = z.infer<typeof ModuleSchema>;

/** A module FOLDER's config (config.yaml at the root of a `_modules`) — just the namespace every module in it is addressed by. */
export const ModuleConfigSchema = z
  .object({ namespace: z.string().min(1) })
  .strict();
