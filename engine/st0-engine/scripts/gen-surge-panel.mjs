// gen-surge-panel.mjs — write the Surge XT module's panel (ui.yaml + widgets.js) from what the ENGINE says Surge
// has: `st0-engine --dump-surge-layout`. Run it after bumping Surge; both files are generated and committed.
// The one thing a reader would get wrong: a slot's knob is generic on purpose — what it does follows its owner's
// TYPE, which the screens beside it name from the same dump, so no label goes stale. docs/surgePlugin.md.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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

const COLS = 24;
const ROWS = 11;
const BLUE = "#3d7dff26";
const GREEN = "#3ec96b26";
const ORANGE = "#ff6a1a26";
const PURPLE = "#a05cff26";

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

// The kinds of control, each sized and ranged off the engine's own parameter.
const knob = (name, col, row, label, size = 2) => {
  const p = param(name);
  return { type: "knob", col, row, colSpan: size, rowSpan: size, label, bind: name, min: p.min, max: p.max, ...(p.discrete ? { step: 1 } : {}) };
};
const toggle = (name, col, row, label, span = 1) => (param(name), { type: "toggle", col, row, colSpan: span, label, bind: name });
const number = (name, col, row, label, span = 2) => {
  const p = param(name);
  return { type: "number", col, row, colSpan: span, label, bind: name, min: p.min, max: p.max, step: 1 };
};
const dropdown = (name, col, row, label, span, skip = new Set()) => {
  const p = param(name);
  const options = p.choices
    .map((c, i) => ({ label: c, value: p.min + i }))
    .filter((o) => !skip.has(o.label));
  return { type: "dropdown", col, row, colSpan: span, label, bind: name, options };
};
const group = (col, row, colSpan, rowSpan, label, color) => ({ type: "group", col, row, colSpan, rowSpan, label, color });
const screen = (col, row, colSpan, rowSpan) => ({ type: "lcdscreen", col, row, colSpan, rowSpan });

/** A tab's widgets, ids prefixed so they stay unique across the panel. */
function tab(prefix, entries) {
  return Object.fromEntries(entries.map(([id, w]) => [`${prefix}_${id}`, w]));
}

/** One oscillator's page: its own controls, its mix channel, and the effects its sound goes through. */
function oscTab(S, n) {
  const o = `${S} Osc ${n}`;
  return [
    ["grp", group(0, 1, 19, 4, `OSC ${n}`, BLUE)],
    ["type", dropdown(`${o} Type`, 0, 1, "Type", 3, NO_INPUT_OSC)],
    ["oct", number(`${o} Octave`, 0, 2, "Octave", 3)],
    ["key", toggle(`${o} Keytrack`, 0, 3, "Key")],
    ["retrig", toggle(`${o} Retrigger`, 1, 3, "Retrig", 2)],
    ["pitch", knob(`${o} Pitch`, 3, 2, "Pitch")],
    ...Array.from({ length: 7 }, (_, i) => [`p${i + 1}`, knob(`${o} Param ${i + 1}`, 5 + i * 2, 2, String(i + 1))]),
    ["screen", screen(19, 1, 5, 4)],
    ["mix_grp", group(0, 5, 6, 6, "MIX", GREEN)],
    ["route", dropdown(`${o} Route`, 0, 5, "Route", 6)],
    ["level", knob(`${o} Volume`, 0, 6, "Level")],
    ["mute", toggle(`${o} Mute`, 2, 6, "M", 2)],
    ["solo", toggle(`${o} Solo`, 2, 7, "S", 2)],
    ["fx", screen(6, 5, 18, 6)],
  ];
}

/** What a scene adds over its oscillators: the ring modulators, the noise, and the scene's own controls. */
function sceneTab(S) {
  const out = [];
  const channels = [
    ["r12", "Ring Modulation 1x2", "RING 1×2"],
    ["r23", "Ring Modulation 2x3", "RING 2×3"],
    ["noise", "Noise", "NOISE"],
  ];
  channels.forEach(([id, name, label], k) => {
    const c = k * 4;
    out.push([`${id}_grp`, group(c, 1, 4, 4, label, GREEN)]);
    out.push([`${id}_route`, dropdown(`${S} ${name} Route`, c, 1, "Route", 4)]);
    out.push([`${id}_level`, knob(`${S} ${name} Volume`, c, 2, "Level")]);
    out.push([`${id}_mute`, toggle(`${S} ${name} Mute`, c + 2, 2, "M", 2)]);
    out.push([`${id}_solo`, toggle(`${S} ${name} Solo`, c + 2, 3, "S", 2)]);
  });
  out.push(["scene_grp", group(0, 5, 24, 6, "SCENE", PURPLE)]);
  out.push(["playmode", dropdown(`${S} Play Mode`, 0, 5, "Play mode", 4)]);
  out.push(["fmroute", dropdown(`${S} FM Routing`, 4, 5, "FM routing", 4)]);
  out.push(["octave", number(`${S} Octave`, 8, 5, "Octave", 2)]);
  out.push(["ktroot", number(`${S} Keytrack Root Key`, 10, 5, "Key root", 3)]);
  const knobs = [
    ["pitch", "Pitch", "Pitch"],
    ["porta", "Portamento", "Glide"],
    ["fmdepth", "FM Depth", "FM"],
    ["drift", "Osc Drift", "Drift"],
    ["noisecol", "Noise Color", "Noise col"],
    ["pfg", "Pre-Filter Gain", "Pre gain"],
    ["volume", "Volume", "Volume"],
    ["pan", "Pan", "Pan"],
    ["width", "Width", "Width"],
    ["send1", "Send FX 1 Level", "Send 1"],
    ["send2", "Send FX 2 Level", "Send 2"],
    ["send3", "Send FX 3 Level", "Send 3"],
  ];
  knobs.forEach(([id, name, label], k) => out.push([id, knob(`${S} ${name}`, k * 2, 6, label)]));
  out.push(["send4", knob(`${S} Send FX 4 Level`, 0, 8, "Send 4")]);
  return out;
}

function filterTab(S) {
  const out = [];
  out.push(["cfg", dropdown(`${S} Filter Configuration`, 0, 1, "Routing", 4)]);
  out.push(["wstype", dropdown(`${S} Waveshaper Type`, 4, 1, "Waveshaper", 5)]);
  out.push(["f2off", toggle(`${S} Filter 2 Offset Mode`, 9, 1, "F2 offset", 2)]);
  out.push(["linkres", toggle(`${S} Link Resonance`, 11, 1, "Link res", 2)]);
  for (const n of [1, 2]) {
    const c = (n - 1) * 12;
    const f = `${S} Filter ${n}`;
    out.push([`f${n}_grp`, group(c, 2, 12, 3, `FILTER ${n}`, ORANGE)]);
    out.push([`f${n}_type`, dropdown(`${f} Type`, c, 2, "Type", 4)]);
    out.push([`f${n}_sub`, number(`${f} Subtype`, c, 3, "Subtype", 4)]);
    out.push([`f${n}_cut`, knob(`${f} Cutoff`, c + 4, 3, "Cutoff")]);
    out.push([`f${n}_res`, knob(`${f} Resonance`, c + 6, 3, "Reso")]);
    out.push([`f${n}_env`, knob(`${f} FEG Mod Amount`, c + 8, 3, "Env")]);
    out.push([`f${n}_key`, knob(`${f} Keytrack`, c + 10, 3, "Key")]);
  }
  const knobs = [
    ["fb", "Feedback", "Feedback"],
    ["bal", "Filter Balance", "Balance"],
    ["hp", "Highpass", "Highpass"],
    ["wsdrive", "Waveshaper Drive", "Drive"],
    ["vca", "VCA Gain", "VCA"],
    ["velvca", "Velocity > VCA Gain", "Vel>VCA"],
  ];
  knobs.forEach(([id, name, label], k) => out.push([id, knob(`${S} ${name}`, k * 2, 5, label)]));
  for (const [n, eg, label] of [[1, "Amp EG", "AMP EG"], [2, "Filter EG", "FILTER EG"]]) {
    const c = (n - 1) * 12;
    const e = `${S} ${eg}`;
    out.push([`eg${n}_grp`, group(c, 7, 12, 4, label, PURPLE)]);
    out.push([`eg${n}_mode`, dropdown(`${e} Envelope Mode`, c, 7, "Mode", 4)]);
    ["Attack", "Decay", "Sustain", "Release"].forEach((stage, k) =>
      out.push([`eg${n}_${stage[0].toLowerCase()}`, knob(`${e} ${stage}`, c + k * 2, 8, stage[0])]),
    );
    out.push([`eg${n}_ash`, dropdown(`${e} Attack Shape`, c, 10, "A shape", 2)]);
    out.push([`eg${n}_dsh`, dropdown(`${e} Decay Shape`, c + 2, 10, "D shape", 2)]);
    out.push([`eg${n}_rsh`, dropdown(`${e} Release Shape`, c + 6, 10, "R shape", 2)]);
    out.push([`eg${n}_screen`, screen(c + 8, 7, 4, 4)]);
  }
  return out;
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

function lfoTab(S, kind) {
  const out = [];
  for (let n = 1; n <= 6; n++) {
    const r = n;
    const l = `${S} ${kind} ${n}`;
    out.push([`l${n}_type`, dropdown(`${l} Type`, 0, r, `${n}`, 3)]);
    out.push([`l${n}_trig`, dropdown(`${l} Trigger Mode`, 3, r, "Trigger", 3)]);
    out.push([`l${n}_uni`, toggle(`${l} Unipolar`, 6, r, "Uni")]);
    LFO_KNOBS.forEach(([id, name, label], k) => out.push([`l${n}_${id}`, knob(`${l} ${name}`, 7 + k, r, label, 1)]));
  }
  out.push(["screen", screen(17, 1, 7, 6)]);
  return out;
}

function fxTab(slots, withGlobals) {
  const out = [];
  slots.forEach((slot, k) => {
    const r = 1 + k;
    out.push([`${slot}_type`, dropdown(`FX ${slot} Type`, 0, r, slot, 4, NO_INPUT_FX)]);
    for (let p = 1; p <= 12; p++) out.push([`${slot}_p${p}`, knob(`FX ${slot} Param ${p}`, 3 + p, r, String(p), 1)]);
  });
  out.push(["screen", screen(16, 1, 8, 8)]);
  if (withGlobals) {
    out.push(["glob_grp", group(0, 9, 24, 2, "GLOBAL", PURPLE)]);
    for (let s = 1; s <= 4; s++) out.push([`ret${s}`, knob(`Send FX ${s} Return`, (s - 1) * 2, 9, `Return ${s}`)]);
    out.push(["gvol", knob("Global Volume", 8, 9, "Global")]);
    out.push(["poly", number("Polyphony Limit", 10, 9, "Voices", 2)]);
    out.push(["bypass", dropdown("FX Chain Bypass", 12, 9, "FX chain", 4)]);
    out.push(["character", dropdown("Character", 16, 9, "Character", 3)]);
  }
  return out;
}

const tabs = [];
for (const S of ["A", "B"]) {
  const s = S.toLowerCase();
  for (let n = 1; n <= 3; n++) tabs.push({ name: `${S} OSC ${n}`, widgets: tab(`${s}osc${n}`, oscTab(S, n)) });
  tabs.push({ name: `${S} SCENE`, widgets: tab(`${s}scene`, sceneTab(S)) });
  tabs.push({ name: `${S} FILTER`, widgets: tab(`${s}flt`, filterTab(S)) });
  tabs.push({ name: `${S} LFO`, widgets: tab(`${s}lfo`, lfoTab(S, "LFO")) });
  tabs.push({ name: `${S} S-LFO`, widgets: tab(`${s}slfo`, lfoTab(S, "Scene LFO")) });
}
tabs.push({ name: "FX A/B", widgets: tab("fxab", fxTab(["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4"], false)) });
tabs.push({ name: "FX S/G", widgets: tab("fxsg", fxTab(["S1", "S2", "S3", "S4", "G1", "G2", "G3", "G4"], true)) });

// On every tab: the level and the eight macros — what Surge keeps in view whatever its page. No patch picker: a
// patch is chosen from the node's PRESETS, one per patch, which also drop the values set over the last one.
const shared = {
  // The engine's own trim, not one of Surge's parameters: the range SurgePlugin declares for it.
  volume: { type: "knob", col: 0, row: 0, colSpan: 1, rowSpan: 1, label: "Vol", bind: "Volume", min: -40, max: 12 },
  ...Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [`macro${i + 1}`, knob(`Macro ${i + 1}`, 2 + i, 0, `M${i + 1}`, 1)]),
  ),
};

const lines = [
  "# panel for @st0/instruments/synth/surge-xt — GENERATED by engine/st0-engine/scripts/gen-surge-panel.mjs; edit that, not this.",
  "#",
  "# Surge XT's own layout on our widgets: a page per oscillator with its mix and the effects it reaches, then the",
  "# scene's sections, A then B, and the effects. A slot's knob is",
  "# numbered because its meaning follows its owner's type — the screen beside it names each one for the type set.",
  `cols: ${COLS}`,
  `rows: ${ROWS}`,
  "widgets:",
  ...Object.entries(shared).map(([id, w]) => `  ${id}: ${widget(w)}`),
  "tabs:",
];
for (const t of tabs) {
  lines.push(`  - name: ${q(t.name)}`);
  lines.push("    widgets:");
  for (const [id, w] of Object.entries(t.widgets)) lines.push(`      ${id}: ${widget(w)}`);
}
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
  screens.push(`  ${s}flt_eg1_screen: (lcd) => egScreen(lcd, "${S} Amp EG"),`);
  screens.push(`  ${s}flt_eg2_screen: (lcd) => egScreen(lcd, "${S} Filter EG"),`);
  screens.push(`  ${s}lfo_screen: (lcd) => lfoScreen(lcd, "${S} LFO"),`);
  screens.push(`  ${s}slfo_screen: (lcd) => lfoScreen(lcd, "${S} Scene LFO"),`);
}
screens.push(`  fxab_screen: (lcd) => fxScreen(lcd, ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4"]),`);
screens.push(`  fxsg_screen: (lcd) => fxScreen(lcd, ["S1", "S2", "S3", "S4", "G1", "G2", "G3", "G4"]),`);

const js = `// Surge XT screens — GENERATED by engine/st0-engine/scripts/gen-surge-panel.mjs from the engine's own dump; edit that.
// Each names what a slot's numbered knobs do for the type set now, and sketches what the knobs around it shape.

const OSC_TYPES = ${JSON.stringify(oscTypes)};
const FX_TYPES = ${JSON.stringify(fxTypes)};
const LFO_SHAPES = ${JSON.stringify(lfoShapes)};
const ROUTES = ${JSON.stringify(routes)};
const FONT = "9px ui-monospace, monospace";
const SMALL = "8px ui-monospace, monospace";

function clear(lcd) {
  lcd.ctx.fillStyle = lcd.color.bg;
  lcd.ctx.fillRect(0, 0, lcd.width, lcd.height);
}

function text(lcd, s, x, y, col, font) {
  lcd.ctx.fillStyle = col || lcd.color.ink;
  lcd.ctx.font = font || FONT;
  lcd.ctx.textAlign = "left";
  lcd.ctx.fillText(s, x, y);
}

const at = (lcd, name, fallback) => {
  const v = lcd.params[name];
  return typeof v === "number" ? v : fallback;
};

// Surge's envelope times are 2^x seconds with x from -8 to 5, which the 0..1 knob spans linearly.
const egSeconds = (v) => Math.pow(2, -8 + 13 * v);

function oscScreen(lcd, osc) {
  clear(lcd);
  const t = OSC_TYPES[Math.round(at(lcd, osc + " Type", 0))] || OSC_TYPES[0];
  text(lcd, t.name.toUpperCase(), 6, 14, lcd.color.glow);
  t.slots.forEach((slot, k) => {
    if (!slot) return;
    const v = at(lcd, osc + " Param " + (k + 1), 0);
    const y = 28 + k * 11;
    text(lcd, (k + 1) + " " + slot, 6, y, lcd.color.ink, SMALL);
    lcd.ctx.fillStyle = lcd.color.dim;
    lcd.ctx.fillRect(lcd.width - 40, y - 6, 34, 4);
    lcd.ctx.fillStyle = lcd.color.ink;
    lcd.ctx.fillRect(lcd.width - 40, y - 6, 34 * Math.max(0, Math.min(1, v)), 4);
  });
}

function egScreen(lcd, eg) {
  clear(lcd);
  const { ctx, width: W, height: H } = lcd;
  const a = egSeconds(at(lcd, eg + " Attack", 0)), d = egSeconds(at(lcd, eg + " Decay", 0.5));
  const s = at(lcd, eg + " Sustain", 1), r = egSeconds(at(lcd, eg + " Release", 0.3));
  // Seconds on a compressed axis, so a 1 ms attack and a 30 s release both read.
  const tx = (t) => Math.log10(1 + t * 20);
  const scale = Math.max(1, tx(a) + tx(d) + 0.6 + tx(r)) * 1.05;
  const x = (u) => 6 + (u / scale) * (W - 12);
  const top = 10, bottom = H - 8, ys = bottom - s * (bottom - top);
  const xa = x(tx(a)), xd = x(tx(a) + tx(d)), xs = x(tx(a) + tx(d) + 0.6), xr = x(tx(a) + tx(d) + 0.6 + tx(r));
  ctx.strokeStyle = lcd.color.ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x(0), bottom);
  ctx.lineTo(xa, top);
  ctx.lineTo(xd, ys);
  ctx.lineTo(xs, ys);
  ctx.lineTo(xr, bottom);
  ctx.stroke();
}

// One cycle of an LFO shape at phase p, -1..1; the shapes Surge draws from data (step, MSEG, formula) are a flat line.
function lfoShape(shape, p) {
  switch (LFO_SHAPES[shape]) {
    case "Sine": return Math.sin(2 * Math.PI * p);
    case "Triangle": return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    case "Square": return p < 0.5 ? 1 : -1;
    case "Sawtooth": return 1 - 2 * p;
    case "Noise": case "Sample & Hold": { const k = Math.floor(p * 8); const h = Math.sin(k * 12.9898 + shape) * 43758.5453; return 2 * (h - Math.floor(h)) - 1; }
    case "Envelope": return p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8;
    default: return 0;
  }
}

function lfoScreen(lcd, lfo) {
  clear(lcd);
  const { ctx, width: W, height: H } = lcd;
  const row = H / 6;
  for (let n = 1; n <= 6; n++) {
    const shape = Math.round(at(lcd, lfo + " " + n + " Type", 0));
    const y = (n - 1) * row;
    text(lcd, n + " " + (LFO_SHAPES[shape] || ""), 4, y + 11, lcd.color.dim, SMALL);
    const amp = at(lcd, lfo + " " + n + " Amplitude", 1);
    const x0 = W * 0.45, w = W - x0 - 4, mid = y + row / 2;
    ctx.strokeStyle = lcd.color.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const v = lfoShape(shape, (i / 64) * 2 % 1) * amp;
      const px = x0 + (i / 64) * w, py = mid - v * (row / 2 - 3);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

function fxScreen(lcd, slots) {
  clear(lcd);
  let y = 12;
  for (const slot of slots) {
    const t = FX_TYPES[Math.round(at(lcd, "FX " + slot + " Type", 0))] || FX_TYPES[0];
    if (t.name === "Off") {
      text(lcd, slot + "  —", 4, y, lcd.color.dim, SMALL);
      y += 11;
      continue;
    }
    text(lcd, slot + "  " + t.name, 4, y, lcd.color.glow);
    y += 11;
    const named = t.slots.map((s, k) => (s ? (k + 1) + " " + s : "")).filter(Boolean).join("  ");
    // Wrapped by width, so twelve names fit the screen however long they are.
    lcd.ctx.font = SMALL;
    let line = "";
    for (const word of named.split("  ")) {
      const next = line ? line + "  " + word : word;
      if (lcd.ctx.measureText(next).width > lcd.width - 12 && line) {
        text(lcd, line, 10, y, lcd.color.ink, SMALL);
        y += 10;
        line = word;
      } else line = next;
    }
    if (line) {
      text(lcd, line, 10, y, lcd.color.ink, SMALL);
      y += 12;
    }
  }
}

// How much of an effect a slot applies: its own Mix where its type has one, else all of it.
function fxMix(lcd, slot, t) {
  const k = t.slots.indexOf("Mix");
  return k < 0 ? 1 : Math.max(0, Math.min(1, at(lcd, "FX " + slot + " Param " + (k + 1), 1)));
}

// The effects one oscillator's sound goes through, in order, each with how much of it applies (docs/surgePlugin.md).
function fxReachScreen(lcd, S, n) {
  clear(lcd);
  const osc = S + " Osc " + n;
  const muted = at(lcd, osc + " Mute", 0) >= 0.5;
  const route = ROUTES[Math.round(at(lcd, osc + " Route", 1))] || "";
  const level = at(lcd, osc + " Volume", 1);
  text(lcd, "OSC " + n + " → " + route + (muted ? "   MUTED" : "   level " + Math.round(level * 100) + "%"), 6, 12, muted ? lcd.color.dim : lcd.color.glow);
  // 0 all on, 1 no sends, 2 no sends nor globals, 3 none: Surge's FX Chain Bypass choices in order.
  const bypass = Math.round(at(lcd, "FX Chain Bypass", 0));
  const groups = [
    { label: "SCENE " + S, slots: [1, 2, 3, 4].map((k) => S + k), on: bypass < 3, amount: (slot, t) => fxMix(lcd, slot, t) },
    { label: "SEND", slots: ["S1", "S2", "S3", "S4"], on: bypass < 1,
      amount: (slot, t, k) => at(lcd, S + " Send FX " + k + " Level", 0) * at(lcd, "Send FX " + k + " Return", 1) * fxMix(lcd, slot, t) },
    { label: "GLOBAL", slots: ["G1", "G2", "G3", "G4"], on: bypass < 2, amount: (slot, t) => fxMix(lcd, slot, t) },
  ];
  const colW = (lcd.width - 12) / 3;
  groups.forEach((g, gi) => {
    const x = 6 + gi * colW;
    let y = 28;
    text(lcd, g.label + (g.on ? "" : " · off"), x, y, lcd.color.dim, SMALL);
    g.slots.forEach((slot, k) => {
      y += 13;
      const t = FX_TYPES[Math.round(at(lcd, "FX " + slot + " Type", 0))] || FX_TYPES[0];
      if (t.name === "Off") {
        text(lcd, slot + " —", x, y, lcd.color.dim, SMALL);
        return;
      }
      const amount = g.on && !muted ? g.amount(slot, t, k + 1) : 0;
      text(lcd, slot + " " + t.name, x, y, amount > 0 ? lcd.color.ink : lcd.color.dim, SMALL);
      const bw = colW - 14;
      lcd.ctx.fillStyle = lcd.color.dim;
      lcd.ctx.fillRect(x, y + 3, bw, 3);
      lcd.ctx.fillStyle = lcd.color.glow;
      lcd.ctx.fillRect(x, y + 3, bw * amount, 3);
    });
  });
}

export default {
${screens.join("\n")}
};
`;
writeFileSync(join(OUT, "widgets.js"), js);
const count = Object.keys(shared).length + tabs.reduce((n, t) => n + Object.keys(t.widgets).length, 0);
console.log(`surge-xt panel: ${tabs.length} tabs, ${count} widgets → ${OUT}`);

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
