// moduleSchema.ts — a module file's shape, in Zod. The single, authoritative schema
// (no second generated copy to drift from it). Deliberately does NOT check reference
// fields (`extends`, a rack's `clip`) — those need the rest of the project and live in
// TS (graph.ts validate(), nodeProject's ref pass) instead.

import { z } from "zod";
import { MODULE_STATUSES, SHAPE_KINDS } from "../moduleTypes";
import { PlacementSchema } from "./placementSchema";

/** An interface input: a preferences label, or one/two physical channel numbers. */
export const InputSchema = z.union([
  z.string().min(1),
  z.tuple([z.number().int().positive()]),
  z.tuple([z.number().int().positive(), z.number().int().positive()]),
]);

/** One rack sound: the note it answers to, plus either a clip or a [from,to) window. */
export const RackSoundSchema = z.object({
  note: z.number().int().min(0).max(127),
  clip: z.string().min(1).optional(),
  from: z.number().min(0).optional(),
  to: z.number().positive().optional(),
});

// The rack's two flavours by `rack_type`: a discriminated union gives the better error for the flavour asked for.
const SamplesRack = z.object({
  rack_type: z.literal("samples").default("samples"),
  symbols: z.record(
    z.string(),
    RackSoundSchema.extend({ clip: z.string().min(1) }),
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
 *  node's own TAKE — its whole picture, growing (engine/st0-engine/docs/recorder.md). */
export const WAVEFORM_SOURCES = ["input", "output", "take"] as const;

/** Every `io:` a module may declare. Named for WAVEFORM_SOURCES' reason: `fields.ts` offers it. */
export const IO_KINDS = ["out", "in", "video_out", "file", "camera"] as const;

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
  "tabs",
  "waveform",
  "dropdown",
  // Picks a FILE the module carries for a file-valued param (`bind: nam`) — see docs/filePicker.md.
  "filepicker",
  // A screen the module's WIDGETS_SCRIPT draws, looked up by the widget's id; it binds nothing.
  "lcdscreen",
] as const;

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
});

export type Widget = z.infer<typeof WidgetBase> & {
  pages?: Record<string, Record<string, Widget>>;
};

const RANGED = new Set(["knob", "slider", "fader", "number"]);

export const WidgetSchema: z.ZodType<Widget> = WidgetBase.extend({
  // tabs: named pages of sub-widgets. Recursive, hence the getter.
  get pages() {
    return z.record(z.string(), z.record(z.string(), WidgetSchema)).optional();
  },
}).superRefine((w, ctx) => {
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
        "a filepicker needs `bind` — the file-valued param it writes (e.g. bind: nam)",
    });
  if (w.type === "tabs" && w.pages === undefined)
    ctx.addIssue({
      code: "custom",
      path: ["pages"],
      message: "tabs need pages",
    });
});

export const UISchema = z.object({
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  widgets: z.record(z.string(), WidgetSchema),
});

/** A module's whole widget grid — what the visual editor reads and writes. */
export type ModuleUI = z.infer<typeof UISchema>;

// One `ui.yaml`: the panel beside a module's `module.yaml`, naming no module — the folder does (docs/moduleFile.md).
export const UiFileSchema = UISchema.strict();

export type UiFile = z.infer<typeof UiFileSchema>;

// One `presets.yaml`: the module's named settings, and a preset IS its values — numbers only (docs/moduleFile.md).
export const PresetsFileSchema = z.record(
  z.string().min(1),
  z.record(z.string().min(1), z.number()),
);

export type PresetsFile = z.infer<typeof PresetsFileSchema>;

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
  // A param is a NUMBER, except the few the plugin steers with a file it loads — see docs/moduleAssets.md.
  params: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  rack: RackSchema.optional(),
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
  // FROZEN at this module: the render standing in for everything UPSTREAM of it — see docs/freeze.md.
  frozen: z.string().min(1).optional(),
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
    // …and what they CALL it: free text, the name a person reads in a picker (packages/song/docs/moduleLabel.md).
    label: z.string().optional(),
  })
  .strict(); // an unknown key is a typo — silently ignoring `paramz:` is worse than saying so

export type Module = z.infer<typeof ModuleSchema>;

/** A module FOLDER's config (config.yaml at the root of a `_modules`) — just the namespace every module in it is addressed by. */
export const ModuleConfigSchema = z
  .object({ namespace: z.string().min(1) })
  .strict();
