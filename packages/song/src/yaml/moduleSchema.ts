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

/**
 * One named port a module declares for itself. See docs/ports.md.
 *
 * `mandatory` is an INPUT's business — an output is offered, never required — and defaults to
 * true where it is read, so a port a module bothered to name has to be fed unless it says
 * otherwise. A crossfade's second input is exactly the case for `mandatory: false`: wiring one
 * side and leaving the other silent is a legitimate state, not a half-built chain.
 */
export const PortSchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(["audio", "midi", "video"]),
    mandatory: z.boolean().optional(),
  })
  .strict();

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
  // Picks a FILE the module carries for a file-valued param (`bind: nam`). Its own type rather
  // than a flavour of dropdown: it lists a folder tree with a search field, not a set of values
  // the panel author wrote down. See docs/filePicker.md.
  "filepicker",
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
  // A file picker with nothing to pick FOR is a button that cannot say what it would write:
  // the param it binds is where the chosen file lands, and there is no default worth guessing.
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

// One `controller.yaml`: which MIDI control moves which of the module's params, beside its `module.yaml` like
// the panel and the shelf. The key is the param — one control per param, because two controls fighting over one
// value is a bug rather than a feature. See controller.ts and docs/controller.md.
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
    // "in" and "file" are SOURCES, the rest are sinks — see moduleTypes.IO_SOURCES, which the
    // graph reads rather than re-listing them.
    // "in" and "file" are SOURCES, the rest are sinks — see moduleTypes.IO_SOURCES, which the
    // graph reads rather than re-listing them.
    io: z.enum(["out", "in", "video_out", "file"]).optional(),
    // The module's own PORTS, overriding the defaults its type folder gives (MODULE_TYPES).
    //
    // Declared here because the folder says what a module IS, not how many wires it takes: a
    // crossfade is an audio effect like any other and needs two audio inputs, which was
    // unsayable while the folder was the only source. A module that declares neither keeps its
    // type's ports, which is every module written so far. See docs/ports.md.
    inputs: z.array(PortSchema).optional(),
    outputs: z.array(PortSchema).optional(),
    type: z
      .enum(["plugin", "rack", "video_effect", "video_transition"])
      .optional(), // NOT .default() — the loader applies it (moduleFile.ts) so the file stays as terse as authored
    // A param is a NUMBER, except the few the plugin steers with a file it loads — `nam` names
    // a .nam model in this module's own `assets/`. It sits in params: because that is what it
    // is, one of the plugin's controls shown in the panel beside Input and Output; its own
    // top-level field made it a second kind of thing to find, edit and merge. Only the
    // file-valued ones are strings (moduleTypes.FILE_PARAMS), and nodeProject lifts them out
    // before the wire, which stays numeric. See docs/moduleAssets.md.
    params: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
    rack: RackSchema.optional(),
    // A COLD module: one that only works on material already on disk, because it has to know the
    // whole of its input before it can produce any of it. Normalisation is the plain case — the
    // gain depends on the loudest sample, which may be the last one. Not "expensive": a cold
    // module run live would not be slow, it would be wrong, since the answer does not exist yet.
    //
    // A property of the MODULE, so it is inherited by every use of it (deliberately not in
    // moduleResolve's OWN_ONLY — an instance of a cold module is cold). See docs/coldModules.md.
    cold: z.boolean().optional(),
    // NOTE: there is no `jsdsp:` field. A module whose DSP is its own source says so with
    // `plugin: {type: jsdsp}`, and the file is `jsdsp.ts` beside the module file — one statement
    // instead of two that had to agree. See loader.ts's jsDspFileFor.
    // An io "in" module says WHICH interface input it is, and nothing about where the
    // signal goes: the chain it sits in already names the track. (It used to carry a
    // `track:` too, which meant a shared input module — one per physical input, filed in
    // a workspace's _modules by `module populate` — had nowhere to put a binding that is
    // per-project by nature.)
    channel: InputSchema.optional(),
    // An io "file" module reads an audio FILE instead of an interface channel. Project-relative,
    // and named `source` for the same reason a clip's audio is: it is the same fact. (`file` was
    // the obvious spelling and is taken — the loader writes the module's FOLDER name there, so
    // an authored `file:` was silently overwritten by it.) It may be ABSENT, and that is the
    // useful case rather than an oversight: a chain template's input names none, because the
    // template is generic and whoever applies it supplies the audio — a song hands over its
    // master. See docs/fileInput.md.
    source: z.string().optional(),
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
