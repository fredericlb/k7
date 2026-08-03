// moduleSchema.ts — a module file's shape, in Zod. The single, authoritative schema
// (no second generated copy to drift from it). Deliberately does NOT check reference
// fields (`extends`, a rack's `clip`) — those need the rest of the project and live in
// TS (graph.ts validate(), nodeProject's ref pass) instead.

import { z } from "zod";

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

export const WIDGET_TYPES = [
  "label",
  "knob",
  "slider",
  // A mixer strip's fader: vertical, and it fills the height its rowSpan gives it, which is the point —
  // a fader you cannot make tall is a slider stood on its end.
  "fader",
  "number",
  "toggle",
  "button",
  "meter",
  "tabs",
  "waveform",
  "dropdown",
] as const;

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
  source: z.enum(["input", "output"]).optional(), // waveform
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
  if (w.type !== "waveform" && w.source !== undefined)
    wrong("source", "only a waveform picks an audio tap");
  if (w.type !== "dropdown") {
    if (w.options !== undefined)
      wrong("options", "only a dropdown has settings");
    if (w.library !== undefined)
      wrong("library", "only a dropdown lists a library");
  }
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

// One `ui.yaml`: the panel beside a module's `module.yaml`. Exactly what the `ui:` block was, at the top level
// and in a file of its own, so the plugin scan can rewrite the module without touching hand-drawn work. It says
// nothing about WHICH module it draws — the folder it sits in does. See uiLibrary.ts.
export const UiFileSchema = UISchema.strict();

export type UiFile = z.infer<typeof UiFileSchema>;

// One `presets.yaml`: the module's named settings, beside its `module.yaml` like the panel. A preset IS its
// values — the key names it, the folder says which module it belongs to, and there is nothing else to record.
// Numbers only, because that is what a module's `params:` holds and a preset that could not be written there
// would be one that cannot be applied. See presets.ts.
export const PresetsFileSchema = z.record(
  z.string().min(1),
  z.record(z.string().min(1), z.number()),
);

export type PresetsFile = z.infer<typeof PresetsFileSchema>;

/** The widget kinds, for a picker that must offer exactly what the schema accepts. */
export type WidgetType = Widget["type"];

/** A curve driving a named param — how a module is automated. */
export const AutomationSchema = z
  .object({ param: z.string().min(1), curve: z.string().min(1) })
  .strict();

export const ModuleSchema = z
  .object({
    extends: z.string().optional(),
    // Deliberately open — a plugin's shape is the ENGINE's business, matched as strings against its scan cache.
    plugin: z
      .looseObject({
        type: z.string().optional(),
        name: z.string().optional(),
      })
      .optional(),
    io: z.enum(["out", "in", "video_out"]).optional(),
    type: z
      .enum(["plugin", "rack", "video_effect", "video_transition"])
      .optional(), // NOT .default() — the loader applies it (moduleFile.ts) so the file stays as terse as authored
    params: z.record(z.string(), z.number()).optional(),
    rack: RackSchema.optional(),
    // Files from the project's shared asset library, named by their path inside it.
    ir: z.string().optional(),
    nam: z.string().optional(),
    // The module's DSP, written in JS/TS and living IN THIS FOLDER — a bare filename, not a path, because a
    // module's source belongs to the module the way its .vstpreset does. Compiled to a sibling .json on demand
    // (see readJsDspGraph); the engine only ever sees the graph. Not a library asset like ir/nam: it is source.
    jsdsp: z.string().optional(),
    // An io "in" module says WHICH interface input it is, and nothing about where the
    // signal goes: the chain it sits in already names the track. (It used to carry a
    // `track:` too, which meant a shared input module — one per physical input, filed in
    // a workspace's _modules by `module populate` — had nowhere to put a binding that is
    // per-project by nature.)
    channel: InputSchema.optional(),
    // Whether you hear the input while it plays. A BOOLEAN is the everyday answer — `monitor: true` is what a
    // person writing this file means — and the three-state spelling stays because "auto" is neither: it means
    // audible only once the track is armed, which is the default and cannot be said with a boolean.
    monitor: z.union([z.boolean(), z.enum(["off", "auto", "on"])]).optional(),
    // Input trim, in dB, applied at the interface before anything else sees the signal. 0 is unity; a guitar
    // into a line input usually wants some, a hot synth wants less. Not a plugin's `params:` — there is no
    // plugin here, the input IS the module.
    gain: z.number().optional(),
    ui: UISchema.optional(),
    automations: z.array(AutomationSchema).optional(), // curves driving this module's params
    docs: z.string().optional(),
    todos: z.array(z.string()).optional(),
  })
  .strict(); // an unknown key is a typo — silently ignoring `paramz:` is worse than saying so

export type Module = z.infer<typeof ModuleSchema>;

/** A module FOLDER's config (config.yaml at the root of a `_modules`) — just the namespace every module in it is addressed by. */
export const ModuleConfigSchema = z
  .object({ namespace: z.string().min(1) })
  .strict();
