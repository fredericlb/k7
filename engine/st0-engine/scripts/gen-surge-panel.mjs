// gen-surge-panel.mjs — write the Surge XT module's panel (ui.yaml + widgets.js) from what the ENGINE says Surge
// has: `st0-engine --dump-surge-layout`. Run it after bumping Surge; both files are generated and committed.
// The one thing a reader would get wrong: a slot's knob is generic on purpose — what it does follows its owner's
// TYPE, which the screens beside it name from the same dump, so no label goes stale. docs/surgePlugin.md.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { widgetsJs } from "./gen-surge-widgets.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const moteur = join(here, "..");
const LIBRARY = join(moteur, "..", "..", "st0-library");
const OUT = join(LIBRARY, "modules", "instruments", "synth", "surge-xt");
// The library's preset shelf for that module: what the graph's preset dropdown lists (packages/song/docs/userPresets.md).
const PRESETS = join(LIBRARY, "presets", "st0", "instruments", "synth", "surge-xt");

/** Wherever the current platform's preset put the binary. First one that exists wins. */
function engineBinary() {
  const candidates = [
    "build/windows-msvc/RelWithDebInfo/st0-engine.exe",
    "build/macos-clang/st0-engine",
    "build/dev-gcc/st0-engine",
    "build/dev-clang/st0-engine",
    "build/release-gcc/st0-engine",
  ].map((p) => join(moteur, p));
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`no st0-engine binary — build it first. Looked in:\n  ${candidates.join("\n  ")}`);
  return found;
}

const raw = execFileSync(engineBinary(), ["--dump-surge-layout"], { encoding: "utf8", maxBuffer: 64 << 20 });
const layout = JSON.parse(raw.split("\n").find((l) => l.startsWith("{")));
const byName = new Map(layout.params.map((p) => [p.name, p]));

// Types that need an audio input, which this instrument does not take: left out of the pickers, still loadable.
const NO_INPUT_OSC = new Set(["Audio Input"]);
const NO_INPUT_FX = new Set(["Vocoder", "Audio Input"]);

// Two layouts (packages/ui-module-builder/docs/layouts.md): the panel HORIZONTAL in 4 rows, `vertical:` in 4 columns.
const ROWS = 4;
const VCOLS = 4;
// Every page's sections fit in PAGE columns; the macros sit beyond them, on every tab.
const PAGE = 22;
const COLS = PAGE + 3;
const BLUE = "#3d7dff26";
const GREEN = "#3ec96b26";
const ORANGE = "#ff6a1a26";
const PURPLE = "#a05cff26";
const RED = "#ff3b3026";
const GREY = "#6b6b6b26";

/** The engine parameter a bind names — refused when it does not exist, so the panel never binds a hole. */
function param(name) {
  const p = byName.get(name);
  if (!p) throw new Error(`the engine has no Surge parameter named "${name}"`);
  return p;
}

const q = (s) => JSON.stringify(String(s));

/** One widget as a YAML flow mapping, its fields in a fixed order. */
function widget(fields) {
  const order = ["type", "col", "row", "colSpan", "rowSpan", "label", "bind", "min", "max", "step", "options", "color"];
  const parts = [];
  for (const k of order) {
    const v = fields[k];
    if (v === undefined) continue;
    if (k === "options")
      parts.push(`options: [ ${v.map((o) => `{ label: ${q(o.label)}, value: ${o.value} }`).join(", ")} ]`);
    else if (typeof v === "string") parts.push(`${k}: ${q(v)}`);
    else parts.push(`${k}: ${v}`);
  }
  return `{ ${parts.join(", ")} }`;
}

// The kinds of control, ranged off the engine's own parameter; WHERE each goes is the section's, once per layout.
const knob = (name, label) => {
  const p = param(name);
  return { type: "knob", label, bind: name, min: p.min, max: p.max, ...(p.discrete ? { step: 1 } : {}) };
};
const toggle = (name, label) => (param(name), { type: "toggle", label, bind: name });
const number = (name, label) => {
  const p = param(name);
  return { type: "number", label, bind: name, min: p.min, max: p.max, step: 1 };
};
const dropdown = (name, label, skip = new Set()) => {
  const p = param(name);
  const options = p.choices.map((c, i) => ({ label: c, value: p.min + i })).filter((o) => !skip.has(o.label));
  return { type: "dropdown", label, bind: name, options };
};
const screen = () => ({ type: "lcdscreen" });

// Boxes `[col, row, colSpan, rowSpan]` relative to their section, keyed by control id.
const line = (ids, c, r, w, h) => Object.fromEntries(ids.map((id, k) => [id, [c + k * w, r, w, h]]));
const stack = (ids, c, r, w, h) => Object.fromEntries(ids.map((id, k) => [id, [c, r + k * h, w, h]]));
const grid = (ids, per, c, r, s) =>
  Object.fromEntries(ids.map((id, k) => [id, [c + (k % per) * s, r + Math.floor(k / per) * s, s, s]]));

/** A section: its controls `[[id, widget]]`, framed by a tinted group when labelled, with a box per control in EACH layout. */
function section(key, label, color, controls, h, v) {
  for (const [id] of controls)
    if (!h[id] || !v[id]) throw new Error(`section ${key}: \`${id}\` has no box in ${h[id] ? "the vertical" : "the horizontal"} layout`);
  return { key, label, color, controls, h, v };
}

const extent = (boxes) => [
  Math.max(...Object.values(boxes).map(([c, , w]) => c + w)),
  Math.max(...Object.values(boxes).map(([, r, , h]) => r + h)),
];

/** A section's widgets in one layout, shifted to its origin, its group first. */
function place(sec, prefix, boxes, c0, r0) {
  const out = [];
  if (sec.label) {
    const [w, h] = extent(boxes);
    out.push([`${prefix}${sec.key}_grp`, { type: "group", col: c0, row: r0, colSpan: w, rowSpan: h, label: sec.label, color: sec.color }]);
  }
  for (const [id, wd] of sec.controls) {
    const [c, r, cs, rs] = boxes[id];
    out.push([`${prefix}${id}`, { ...wd, col: c0 + c, row: r0 + r, colSpan: cs, rowSpan: rs }]);
  }
  return out;
}

/** A page: sections left to right across ROWS (or at the `at` given), and the same sections stacked in VCOLS from `top`. */
function page(name, prefix, sections, top) {
  const h = [];
  const v = [];
  let col = 0;
  let row = top;
  for (const { sec, at } of sections) {
    const [hc, hr] = at ?? [col, 0];
    h.push(...place(sec, prefix, sec.h, hc, hr));
    if (!at) col += extent(sec.h)[0];
    v.push(...place(sec, prefix, sec.v, 0, row));
    row += extent(sec.v)[1];
  }
  return { name, h: Object.fromEntries(h), v: Object.fromEntries(v) };
}

// The level and the eight macros, on every tab: what Surge keeps in view whatever its page (docs/surgePlugin.md).
const MACROS = [...Array.from({ length: 8 }, (_, i) => `macro${i + 1}`), "volume"];
const macros = section(
  "macros",
  "MACROS",
  GREY,
  [
    ...Array.from({ length: 8 }, (_, i) => [`macro${i + 1}`, knob(`Macro ${i + 1}`, `M${i + 1}`)]),
    // The engine's own trim, not one of Surge's parameters: the range SurgePlugin declares for it.
    ["volume", { type: "knob", label: "Vol", bind: "Volume", min: -40, max: 12 }],
  ],
  grid(MACROS, 3, 0, 0, 1),
  grid(MACROS, VCOLS, 0, 0, 1),
);
const TOP = extent(macros.v)[1];

/** A mix channel: where it goes, how loud, mute and solo. */
function channel(key, label, base) {
  return section(
    key,
    label,
    GREEN,
    [
      [`${key}_route`, dropdown(`${base} Route`, "Route")],
      [`${key}_level`, knob(`${base} Volume`, "Level")],
      [`${key}_mute`, toggle(`${base} Mute`, "M")],
      [`${key}_solo`, toggle(`${base} Solo`, "S")],
    ],
    { [`${key}_route`]: [0, 0, 2, 1], [`${key}_level`]: [0, 1, 2, 2], [`${key}_mute`]: [0, 3, 1, 1], [`${key}_solo`]: [1, 3, 1, 1] },
    { [`${key}_route`]: [0, 0, 4, 1], [`${key}_level`]: [0, 1, 2, 2], [`${key}_mute`]: [2, 1, 2, 1], [`${key}_solo`]: [2, 2, 2, 1] },
  );
}

/** A bare screen: no frame, its own size in each layout. */
const screenSec = (key, h, v) => section(key, null, null, [[key, screen()]], { [key]: h }, { [key]: v });

/** One oscillator's page: its own controls, its mix channel, and the effects its sound goes through. */
function oscPage(S, n) {
  const o = `${S} Osc ${n}`;
  const knobs = ["pitch", "p1", "p2", "p3", "p4", "p5", "p6", "p7"];
  const osc = section(
    "osc",
    `OSC ${n}`,
    BLUE,
    [
      ["type", dropdown(`${o} Type`, "Type", NO_INPUT_OSC)],
      ["oct", number(`${o} Octave`, "Octave")],
      ["key", toggle(`${o} Keytrack`, "Key")],
      ["retrig", toggle(`${o} Retrigger`, "Retrig")],
      ["pitch", knob(`${o} Pitch`, "Pitch")],
      ...Array.from({ length: 7 }, (_, i) => [`p${i + 1}`, knob(`${o} Param ${i + 1}`, String(i + 1))]),
    ],
    { ...stack(["type", "oct", "key", "retrig"], 0, 0, 2, 1), ...grid(knobs, 4, 2, 0, 2) },
    { ...line(["type", "oct"], 0, 0, 2, 1), ...line(["key", "retrig"], 0, 1, 2, 1), ...grid(knobs, 2, 0, 2, 2) },
  );
  return page(
    `${S} OSC ${n}`,
    `${S.toLowerCase()}osc${n}_`,
    [
      { sec: osc },
      { sec: screenSec("screen", [0, 0, 4, 4], [0, 0, 4, 3]) },
      { sec: channel("mix", "MIX", o) },
      { sec: screenSec("fx", [0, 0, 6, 4], [0, 0, 4, 4]) },
    ],
    TOP,
  );
}

/** What a scene adds over its oscillators: the ring modulators, the noise, the scene's own controls, its output. */
function scenePage(S) {
  const chans = [
    ["r12", "Ring Modulation 1x2", "RING 1×2"],
    ["r23", "Ring Modulation 2x3", "RING 2×3"],
    ["noise", "Noise", "NOISE"],
  ].map(([key, name, label]) => channel(key, label, `${S} ${name}`));
  const sel = ["playmode", "fmroute", "octave", "ktroot"];
  const knobs = [
    ["pitch", "Pitch", "Pitch"],
    ["porta", "Portamento", "Glide"],
    ["fmdepth", "FM Depth", "FM"],
    ["drift", "Osc Drift", "Drift"],
    ["noisecol", "Noise Color", "Noise col"],
    ["pfg", "Pre-Filter Gain", "Pre gain"],
  ];
  const kids = knobs.map(([id]) => id);
  const scene = section(
    "scene",
    "SCENE",
    PURPLE,
    [
      ["playmode", dropdown(`${S} Play Mode`, "Play mode")],
      ["fmroute", dropdown(`${S} FM Routing`, "FM routing")],
      ["octave", number(`${S} Octave`, "Octave")],
      ["ktroot", number(`${S} Keytrack Root Key`, "Key root")],
      ...knobs.map(([id, name, label]) => [id, knob(`${S} ${name}`, label)]),
    ],
    { ...stack(sel, 0, 0, 2, 1), ...grid(kids, 3, 2, 0, 2) },
    { ...line(sel.slice(0, 2), 0, 0, 2, 1), ...line(sel.slice(2), 0, 1, 2, 1), ...grid(kids, 2, 0, 2, 2) },
  );
  const outIds = ["volume", "pan", "width"];
  const out = section(
    "out",
    "OUT",
    GREEN,
    [
      ["volume", knob(`${S} Volume`, "Volume")],
      ["pan", knob(`${S} Pan`, "Pan")],
      ["width", knob(`${S} Width`, "Width")],
    ],
    grid(outIds, 2, 0, 0, 2),
    grid(outIds, 2, 0, 0, 2),
  );
  const sendIds = ["send1", "send2", "send3", "send4"];
  const sends = section(
    "sends",
    "SENDS",
    RED,
    sendIds.map((id, k) => [id, knob(`${S} Send FX ${k + 1} Level`, `Send ${k + 1}`)]),
    grid(sendIds, 2, 0, 0, 2),
    grid(sendIds, 2, 0, 0, 2),
  );
  return page(`${S} SCENE`, `${S.toLowerCase()}scene_`, [...chans, scene, out, sends].map((sec) => ({ sec })), TOP);
}

/** The filter block in Surge's order: the routing and highpass, filter 1, the waveshaper, filter 2. */
function filterPage(S) {
  const rk = ["hp", "fb", "bal"];
  const routing = section(
    "routing",
    "ROUTING",
    ORANGE,
    [
      ["cfg", dropdown(`${S} Filter Configuration`, "Routing")],
      ["f2off", toggle(`${S} Filter 2 Offset Mode`, "F2 offset")],
      ["linkres", toggle(`${S} Link Resonance`, "Link res")],
      ["hp", knob(`${S} Highpass`, "Highpass")],
      ["fb", knob(`${S} Feedback`, "Feedback")],
      ["bal", knob(`${S} Filter Balance`, "Balance")],
    ],
    { ...stack(["cfg", "f2off", "linkres"], 0, 0, 2, 1), ...grid(rk, 2, 2, 0, 2) },
    { ...line(["cfg", "f2off"], 0, 0, 2, 1), linkres: [0, 1, 2, 1], ...grid(rk, 2, 0, 2, 2) },
  );
  const filter = (n) => {
    const f = `${S} Filter ${n}`;
    const ks = [`f${n}_cut`, `f${n}_res`, `f${n}_env`, `f${n}_key`];
    return section(
      `f${n}`,
      `FILTER ${n}`,
      ORANGE,
      [
        [`f${n}_type`, dropdown(`${f} Type`, "Type")],
        [`f${n}_sub`, number(`${f} Subtype`, "Subtype")],
        [ks[0], knob(`${f} Cutoff`, "Cutoff")],
        [ks[1], knob(`${f} Resonance`, "Reso")],
        [ks[2], knob(`${f} FEG Mod Amount`, "Env")],
        [ks[3], knob(`${f} Keytrack`, "Key")],
      ],
      { ...stack([`f${n}_type`, `f${n}_sub`], 0, 0, 2, 1), ...grid(ks, 2, 2, 0, 2) },
      { ...line([`f${n}_type`, `f${n}_sub`], 0, 0, 2, 1), ...grid(ks, 2, 0, 1, 2) },
    );
  };
  const shaper = section(
    "ws",
    "SHAPER",
    ORANGE,
    [
      ["wstype", dropdown(`${S} Waveshaper Type`, "Type")],
      ["wsdrive", knob(`${S} Waveshaper Drive`, "Drive")],
    ],
    { wstype: [0, 0, 2, 1], wsdrive: [0, 1, 2, 2] },
    { wstype: [0, 0, 4, 1], wsdrive: [0, 1, 2, 2] },
  );
  return page(`${S} FILTER`, `${S.toLowerCase()}flt_`, [routing, filter(1), shaper, filter(2)].map((sec) => ({ sec })), TOP);
}

/** The two envelopes, each beside the curve it draws, then the VCA they end in. */
function envPage(S) {
  const eg = (n, name, label) => {
    const e = `${S} ${name}`;
    const p = (id) => `eg${n}_${id}`;
    const sel = [p("mode"), p("ash"), p("dsh"), p("rsh")];
    const ks = ["a", "d", "s", "r"].map(p);
    return section(
      `eg${n}`,
      label,
      PURPLE,
      [
        [p("mode"), dropdown(`${e} Envelope Mode`, "Mode")],
        [p("ash"), dropdown(`${e} Attack Shape`, "A shape")],
        [p("dsh"), dropdown(`${e} Decay Shape`, "D shape")],
        [p("rsh"), dropdown(`${e} Release Shape`, "R shape")],
        ...["Attack", "Decay", "Sustain", "Release"].map((stage, k) => [ks[k], knob(`${e} ${stage}`, stage[0])]),
        [p("screen"), screen()],
      ],
      { ...stack(sel, 0, 0, 2, 1), ...grid(ks, 2, 2, 0, 2), [p("screen")]: [6, 0, 3, 4] },
      { ...line(sel.slice(0, 2), 0, 0, 2, 1), ...line(sel.slice(2), 0, 1, 2, 1), ...grid(ks, 2, 0, 2, 2), [p("screen")]: [0, 6, 4, 2] },
    );
  };
  const vca = section(
    "vca",
    "VCA",
    GREEN,
    [
      ["vca", knob(`${S} VCA Gain`, "VCA")],
      ["velvca", knob(`${S} Velocity > VCA Gain`, "Vel>VCA")],
    ],
    stack(["vca", "velvca"], 0, 0, 2, 2),
    line(["vca", "velvca"], 0, 0, 2, 2),
  );
  return page(`${S} ENV`, `${S.toLowerCase()}env_`, [eg(1, "Amp EG", "AMP EG"), eg(2, "Filter EG", "FILTER EG"), vca].map((sec) => ({ sec })), TOP);
}

const LFO_KNOBS = [
  ["rate", "Rate", "Rate"],
  ["phase", "Phase", "Phase"],
  ["amp", "Amplitude", "Amp"],
  ["deform", "Deform", "Deform"],
  ["delay", "Delay", "Dly"],
  ["att", "Attack", "Att"],
  ["hold", "Hold", "Hold"],
  ["dec", "Decay", "Dec"],
  ["sus", "Sustain", "Sus"],
  ["rel", "Release", "Rel"],
];
// Three modulators a page: six do not fit 4 rows, so each bank is two pages, each with a screen of its own three.
const LFO_PAGES = [1, 4];

function lfoPage(S, kind, tag, first) {
  const lfos = [first, first + 1, first + 2].map((n) => {
    const l = `${S} ${kind} ${n}`;
    const p = (id) => `l${n}_${id}`;
    const ks = LFO_KNOBS.map(([id]) => p(id));
    return section(
      `l${n}`,
      `${tag} ${n}`,
      BLUE,
      [
        [p("type"), dropdown(`${l} Type`, "Type")],
        [p("uni"), toggle(`${l} Unipolar`, "Uni")],
        [p("trig"), dropdown(`${l} Trigger Mode`, "Trigger")],
        ...LFO_KNOBS.map(([id, name, label]) => [p(id), knob(`${l} ${name}`, label)]),
      ],
      { [p("type")]: [0, 0, 3, 1], [p("uni")]: [3, 0, 2, 1], [p("trig")]: [0, 1, 3, 1], ...grid(ks, 5, 0, 2, 1) },
      { [p("type")]: [0, 0, 4, 1], [p("trig")]: [0, 1, 2, 1], [p("uni")]: [2, 1, 2, 1], ...grid(ks, 4, 0, 2, 1) },
    );
  });
  const name = `${S} ${tag.replace("-", "")} ${first}-${first + 2}`;
  const prefix = `${S.toLowerCase()}${tag === "LFO" ? "lfo" : "slfo"}${first}_`;
  return page(name, prefix, [...lfos, screenSec("screen", [0, 0, 7, 4], [0, 0, 4, 3])].map((sec) => ({ sec })), TOP);
}

/** Four effect slots, one a row, and the screen naming what each slot's numbered knobs do. */
function fxPage(name, prefix, slots) {
  const secs = slots.map((slot, k) => {
    const s = slot.toLowerCase();
    const ks = Array.from({ length: 12 }, (_, i) => `${s}_p${i + 1}`);
    const sec = section(
      s,
      slot,
      RED,
      [
        [`${s}_type`, dropdown(`FX ${slot} Type`, "Type", NO_INPUT_FX)],
        ...ks.map((id, i) => [id, knob(`FX ${slot} Param ${i + 1}`, String(i + 1))]),
      ],
      { [`${s}_type`]: [0, 0, 3, 1], ...line(ks, 3, 0, 1, 1) },
      { [`${s}_type`]: [0, 0, 4, 1], ...grid(ks, 4, 0, 1, 1) },
    );
    return { sec, at: [0, k] };
  });
  return page(name, prefix, [...secs, { sec: screenSec("screen", [0, 0, 7, 4], [0, 0, 4, 4]), at: [15, 0] }], TOP);
}

/** What belongs to no scene: the send returns, the master level, the voices, the chain bypass and the character. */
function globalPage() {
  const rets = ["ret1", "ret2", "ret3", "ret4"];
  const returns = section(
    "returns",
    "RETURNS",
    RED,
    rets.map((id, k) => [id, knob(`Send FX ${k + 1} Return`, `Return ${k + 1}`)]),
    grid(rets, 2, 0, 0, 2),
    grid(rets, 2, 0, 0, 2),
  );
  const master = section(
    "master",
    "MASTER",
    PURPLE,
    [
      ["gvol", knob("Global Volume", "Global")],
      ["bypass", dropdown("FX Chain Bypass", "FX chain")],
      ["character", dropdown("Character", "Character")],
      ["poly", number("Polyphony Limit", "Voices")],
    ],
    { gvol: [0, 0, 2, 2], ...stack(["bypass", "character", "poly"], 2, 0, 3, 1) },
    { gvol: [0, 0, 2, 2], poly: [2, 0, 2, 1], bypass: [0, 2, 4, 1], character: [0, 3, 4, 1] },
  );
  return page("GLOBAL", "glob_", [{ sec: returns }, { sec: master }], TOP);
}

const FX_PAGES = [
  ["FX A", "fxa_", ["A1", "A2", "A3", "A4"]],
  ["FX B", "fxb_", ["B1", "B2", "B3", "B4"]],
  ["FX SEND", "fxs_", ["S1", "S2", "S3", "S4"]],
  ["FX GLOBAL", "fxg_", ["G1", "G2", "G3", "G4"]],
];

const tabs = [];
for (const S of ["A", "B"]) {
  for (let n = 1; n <= 3; n++) tabs.push(oscPage(S, n));
  tabs.push(scenePage(S), filterPage(S), envPage(S));
  for (const first of LFO_PAGES) tabs.push(lfoPage(S, "LFO", "LFO", first));
  for (const first of LFO_PAGES) tabs.push(lfoPage(S, "Scene LFO", "S-LFO", first));
}
for (const [name, prefix, slots] of FX_PAGES) tabs.push(fxPage(name, prefix, slots));
tabs.push(globalPage());

// No patch picker: a patch is chosen from the node's PRESETS, one per patch, which also drop the values set over the last one.
const sharedH = Object.fromEntries(place(macros, "", macros.h, PAGE, 0));
const sharedV = Object.fromEntries(place(macros, "", macros.v, 0, 0));
const vrows = Math.max(...tabs.flatMap((t) => Object.values(t.v).map((w) => w.row + w.rowSpan)));

const block = (indent, shared, pages) => [
  `${indent}widgets:`,
  ...Object.entries(shared).map(([id, w]) => `${indent}  ${id}: ${widget(w)}`),
  `${indent}tabs:`,
  ...pages.flatMap(([name, ws]) => [
    `${indent}  - name: ${q(name)}`,
    `${indent}    widgets:`,
    ...Object.entries(ws).map(([id, w]) => `${indent}      ${id}: ${widget(w)}`),
  ]),
];

const lines = [
  "# panel for @st0/instruments/synth/surge-xt — GENERATED by engine/st0-engine/scripts/gen-surge-panel.mjs; edit that, not this.",
  "#",
  "# Surge XT's own layout on our widgets: a page per oscillator with its mix and the effects it reaches, then the",
  "# scene's sections, A then B, and the effects — horizontal in 4 rows, and stacked in 4 columns under `vertical:`.",
  "# A slot's knob is numbered because its meaning follows its owner's type — the screen beside it names each one.",
  `cols: ${COLS}`,
  `rows: ${ROWS}`,
  ...block("", sharedH, tabs.map((t) => [t.name, t.h])),
  "vertical:",
  `  cols: ${VCOLS}`,
  `  rows: ${vrows}`,
  ...block("  ", sharedV, tabs.map((t) => [t.name, t.v])),
];
writeFileSync(join(OUT, "ui.yaml"), `${lines.join("\n")}\n`);

// The screens: the tables they name things from are the same dump, baked in.
const oscTypes = layout.oscTypes.map((t) => ({ name: t.name, slots: t.slots }));
const fxTypes = layout.fxTypes.map((t) => ({ name: t.name, slots: t.slots }));
const lfoShapes = param("A LFO 1 Type").choices;
const routes = param("A Osc 1 Route").choices;
const screens = [];
for (const S of ["A", "B"]) {
  const s = S.toLowerCase();
  for (let n = 1; n <= 3; n++) {
    screens.push(`  ${s}osc${n}_screen: (lcd) => oscScreen(lcd, "${S} Osc ${n}"),`);
    screens.push(`  ${s}osc${n}_fx: (lcd) => fxReachScreen(lcd, "${S}", ${n}),`);
  }
  screens.push(`  ${s}env_eg1_screen: (lcd) => egScreen(lcd, "${S} Amp EG"),`);
  screens.push(`  ${s}env_eg2_screen: (lcd) => egScreen(lcd, "${S} Filter EG"),`);
  for (const first of LFO_PAGES) {
    screens.push(`  ${s}lfo${first}_screen: (lcd) => lfoScreen(lcd, "${S} LFO", ${first}),`);
    screens.push(`  ${s}slfo${first}_screen: (lcd) => lfoScreen(lcd, "${S} Scene LFO", ${first}),`);
  }
}
for (const [, prefix, slots] of FX_PAGES) screens.push(`  ${prefix}screen: (lcd) => fxScreen(lcd, ${JSON.stringify(slots)}),`);

const js = widgetsJs({ oscTypes, fxTypes, lfoShapes, routes, screens });
writeFileSync(join(OUT, "widgets.js"), js);
const count = Object.keys(sharedH).length + tabs.reduce((n, t) => n + Object.keys(t.h).length, 0);
console.log(`surge-xt panel: ${tabs.length} tabs, ${count} widgets, ${COLS}×${ROWS} and ${VCOLS}×${vrows} → ${OUT}`);

// One FACTORY preset per patch in base/: a name and the base it loads, nothing else, so applying one is that patch.
// Named `<Category> - <Patch>`, which groups the list and keeps two patches of one name in two categories apart.
const presetName = (category, patch) =>
  `${category} - ${patch}`
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/µ/g, "u")
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64)
    .trim();
const patches = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(join(dir, e.name));
    else if (e.name.endsWith(".fxp")) patches.push(relative(join(OUT, "base"), join(dir, e.name)).slice(0, -4));
  }
};
walk(join(OUT, "base"));
rmSync(PRESETS, { recursive: true, force: true });
mkdirSync(PRESETS, { recursive: true });
const names = new Set();
for (const base of patches.sort()) {
  const [category, ...rest] = base.split("/");
  const name = presetName(category, rest.join(" ") || category);
  if (names.has(name)) throw new Error(`two patches make the preset name "${name}"`);
  names.add(name);
  writeFileSync(join(PRESETS, `${name}.yaml`), `# preset for @st0/instruments/synth/surge-xt\nbase: ${JSON.stringify(base)}\n`);
}
console.log(`surge-xt presets: ${names.size} → ${PRESETS}`);
