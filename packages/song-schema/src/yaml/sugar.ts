// sugar.ts — the short forms a .k7x file may write for one kind of data, expanded into that data before anything reads it.
// A sequence's `notes("c4 d4 ~ e4")` and a graph's `runs([...])`; a write that changes what they expand to writes it in full (docs/sugar.md).

import { fileKindFor } from "./fields";

type Data = Record<string, unknown>;
interface Note {
  t: number;
  d: number;
  k: number;
  v?: number;
}

/** A kind's short form: which top-level key holds it, which key it expands into, and the expansion. */
export interface SugarPart {
  key: string;
  target: string;
  /** Is the key, as read, written in the short form rather than as plain data? */
  present: (raw: Data) => boolean;
}
export interface Sugar {
  parts: SugarPart[];
  /** The data with every short form expanded; throws with a message naming what does not read. */
  expand: (raw: Data) => Data;
}

const NOTE = /^([a-gA-G])(#|b)?(-?\d+)$/;
const PITCH: Record<string, number> = {
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11,
};

/** A key as written: a name with its octave (C4 = 60), or a MIDI number. */
function keyOf(word: string): number {
  if (/^\d+$/.test(word)) return Number(word);
  const m = NOTE.exec(word);
  if (!m)
    throw new Error(
      `notes: "${word}" is neither a note name (c4, f#3) nor a MIDI number`,
    );
  const k =
    PITCH[m[1].toLowerCase()] +
    (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) +
    (Number(m[3]) + 1) * 12;
  if (k < 0 || k > 127)
    throw new Error(`notes: "${word}" is outside the MIDI keys`);
  return k;
}

type Step =
  | { kind: "rest" }
  | { kind: "key"; k: number }
  | { kind: "seq"; layers: Weighted[][] };
type Weighted = { step: Step; weight: number };

/** The mini-notation's grammar: steps by spaces, `[a b]` a subdivision, `[a,b]` a chord, `~` a rest, `@n` a length, `!n` a repeat. */
function parseSteps(src: string): Weighted[][] {
  let i = 0;
  const fail = (msg: string): never => {
    throw new Error(`notes: ${msg} at character ${i + 1} of "${src}"`);
  };
  const layers = (close: string | null): Weighted[][] => {
    const out: Weighted[][] = [[]];
    for (;;) {
      while (src[i] === " ") i++;
      const c = src[i];
      if (c === undefined) {
        if (close) fail(`"${close}" missing`);
        return out;
      }
      if (c === close) {
        i++;
        return out;
      }
      if (c === ",") {
        i++;
        out.push([]);
        continue;
      }
      let step: Step;
      if (c === "[") {
        i++;
        step = { kind: "seq", layers: layers("]") };
      } else if (c === "~") {
        i++;
        step = { kind: "rest" };
      } else {
        const m = /^[A-Za-z0-9#-]+/.exec(src.slice(i));
        if (!m) return fail(`unexpected "${c}"`);
        i += m[0].length;
        step = { kind: "key", k: keyOf(m[0]) };
      }
      let weight = 1;
      let times = 1;
      for (;;) {
        const mod = /^([@!])(\d+(?:\.\d+)?)/.exec(src.slice(i));
        if (!mod) break;
        i += mod[0].length;
        if (mod[1] === "@") weight = Number(mod[2]);
        else times = Number(mod[2]);
      }
      for (let n = 0; n < times; n++)
        out[out.length - 1].push({ step, weight });
    }
  };
  return layers(null);
}

const exact = (x: number): number => Math.round(x * 1e9) / 1e9;

/** Every note a sequence of weighted steps holds, laid over [start, start + span). */
function lay(
  steps: Weighted[],
  start: number,
  span: number,
  out: Note[],
): void {
  const total = steps.reduce((n, s) => n + s.weight, 0);
  let at = start;
  for (const { step, weight } of steps) {
    const len = (span * weight) / total;
    if (step.kind === "key")
      out.push({ t: exact(at), d: exact(len), k: step.k });
    else if (step.kind === "seq")
      for (const layer of step.layers) lay(layer, at, len, out);
    at += len;
  }
}

/** A sequence's notes from the short form: one step a beat, or `step` beats; `v` the velocity of every note. */
export function expandNotes(src: string, step = 1, v?: number): Note[] {
  const out: Note[] = [];
  for (const layer of parseSteps(src)) {
    const total = layer.reduce((n, s) => n + s.weight, 0);
    lay(layer, 0, total * step, out);
  }
  out.sort((a, b) => a.t - b.t || a.k - b.k);
  return v === undefined || v === 1 ? out : out.map((n) => ({ ...n, v }));
}

const isRecord = (x: unknown): x is Data =>
  x !== null && typeof x === "object" && !Array.isArray(x);

const NOTES: SugarPart = {
  key: "notes",
  target: "notes",
  present: (raw) =>
    typeof raw.notes === "string" ||
    (isRecord(raw.notes) && typeof raw.notes.seq === "string"),
};

function expandSequence(raw: Data): Data {
  const n = raw.notes;
  if (typeof n === "string") return { ...raw, notes: expandNotes(n) };
  if (isRecord(n) && typeof n.seq === "string") {
    const extra = Object.keys(n).filter(
      (k) => !["seq", "step", "v"].includes(k),
    );
    if (extra.length)
      throw new Error(
        `notes: seq(…) takes step and v, not ${extra.join(", ")}`,
      );
    if (n.step !== undefined && (typeof n.step !== "number" || n.step <= 0))
      throw new Error("notes: step is a number of beats above 0");
    if (n.v !== undefined && (typeof n.v !== "number" || n.v < 0 || n.v > 1))
      throw new Error("notes: v is a velocity from 0 to 1");
    return {
      ...raw,
      notes: expandNotes(
        n.seq,
        n.step as number | undefined,
        n.v as number | undefined,
      ),
    };
  }
  return raw;
}

const RUNS: SugarPart = {
  key: "runs",
  target: "modules",
  present: (raw) => "runs" in raw,
};

/** A graph's runs as segments: each name sends to the next, added after what `modules` already says. */
function expandGraph(raw: Data): Data {
  if (!("runs" in raw)) return raw;
  const { runs, ...rest } = raw;
  if (
    !Array.isArray(runs) ||
    runs.some(
      (r) =>
        !Array.isArray(r) ||
        r.length < 2 ||
        r.some((x) => typeof x !== "string"),
    )
  )
    throw new Error(
      "runs: a list of runs, each a list of two or more node names",
    );
  const modules: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(
    isRecord(rest.modules) ? rest.modules : {},
  ))
    modules[k] = Array.isArray(v) ? [...(v as string[])] : (v as string[]);
  for (const run of runs as string[][])
    for (let i = 0; i + 1 < run.length; i++) {
      const dests = (modules[run[i]] ??= []);
      if (!dests.includes(run[i + 1])) dests.push(run[i + 1]);
    }
  return { ...rest, modules };
}

/** The short forms a file at `path` may write, by its kind; null for a kind that has none. */
export function sugarFor(path: string): Sugar | null {
  const kind = fileKindFor(path);
  if (kind === "sequence") return { parts: [NOTES], expand: expandSequence };
  // A project's graph, and the segments files under their other names: one format, so one short form.
  const p = path.replace(/\\/g, "/");
  const segments =
    /(^|\/)graph\.(ya?ml|k7x)$/i.test(p) ||
    (/(^|\/)chains\.(ya?ml|k7x)$/i.test(p) && !/(^|\/)chains\/[^/]+$/.test(p));
  if (segments) return { parts: [RUNS], expand: expandGraph };
  return null;
}
