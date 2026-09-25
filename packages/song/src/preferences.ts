// preferences.ts — the user's GLOBAL preferences (`<state>/preferences.yaml`): machine and rig config that
// spans every project, unlike the per-project song files. The default audio interface the engine opens, plus
// human-readable labels for its channels — labels are for reading only, unrelated to track names.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  parseSyncTarget,
  type SyncTarget,
} from "@studio/song-schema/syncTarget";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { studioHome } from "./studioHome";

/** Through `studioHome`, never hand-joined — engine-client/docs/paths.md, and the doc that names this file. */
export const PREFS_PATH = join(studioHome(), "preferences.yaml");

export type ChannelDir = "in" | "out";
export interface ChannelLabel {
  ch: number[]; // one or more 1-based channel numbers ([3, 4] == a stereo pair)
  label: string;
}
// The chosen interface. `type` is the driver backend, and they are NOT interchangeable — ASIO is low-latency.
export interface AudioDevicePref {
  name: string;
  type?: string;
}
// Editor settings live here, not the browser: they belong to the person. `vim` defaults ON, like the rest of it.
export interface EditorPref {
  vim: boolean;
}
export interface Preferences {
  audioDevice?: AudioDevicePref; // preferred audio interface (engine opens it on connect)
  channels: { in: ChannelLabel[]; out: ChannelLabel[] };
  /** Which inputs are STEREO, as each pair's 1-based FIRST channel — see engine/st0-engine/docs/audioDevice.md. */
  inputPairs: number[];
  editor: EditorPref;
  /** The chain that SEPARATES a record into stems — one answer for the whole machine, asked once. */
  stemsChain?: string;
  /** …and the one that gives the record WITHOUT ITS VOICE, asked the same way — see packages/file-service/docs/processChain.md. */
  instrumentalChain?: string;
  /** Which output pair the `CUE` bus leaves by — a label from `channels.out`, or the numbers. See docs/cue.md. */
  cueOutput?: string | number[];
  /** The ONNX execution providers this machine SEPARATES on, in order — packages/stem-separation/docs/stemSplit.md. */
  onnxProviders?: string[];
  /** Where this machine can COPY a set list to — a `file://` folder; packages/engine-host/docs/playlistSync.md. */
  syncTargets?: SyncTarget[];
}

// The defaults, in ONE place — every other module builds on this rather than its own literal.
export const defaultPreferences = (): Preferences => ({
  channels: { in: [], out: [] },
  inputPairs: [],
  editor: { vim: true },
});
const empty = defaultPreferences;

// Coerce a parse into a well-formed Preferences; exported so a test need not read the real state dir.
export function normalizePreferences(v: any): Preferences {
  const p = empty();
  if (v && typeof v === "object") {
    const dev = v.audioDevice; // the plain-string form is also accepted — what earlier versions wrote
    if (typeof dev === "string" && dev) p.audioDevice = { name: dev };
    else if (
      dev &&
      typeof dev === "object" &&
      typeof dev.name === "string" &&
      dev.name
    )
      p.audioDevice = {
        name: dev.name,
        ...(typeof dev.type === "string" && dev.type ? { type: dev.type } : {}),
      };
    for (const dir of ["in", "out"] as ChannelDir[]) {
      const list = Array.isArray(v.channels?.[dir]) ? v.channels[dir] : [];
      p.channels[dir] = list
        .map((e: any) => ({
          ch: (Array.isArray(e?.ch) ? e.ch : [e?.ch])
            .map((n: any) => Number(n))
            .filter((n: number) => Number.isInteger(n) && n > 0),
          label: String(e?.label ?? ""),
        }))
        .filter((e: ChannelLabel) => e.ch.length && e.label);
    }
    // Normalised to each pair's ODD channel and deduplicated, since `[2]` names the pair `[1]` does.
    if (Array.isArray(v.inputPairs))
      p.inputPairs = [
        ...new Set<number>(
          v.inputPairs
            .map((n: any) => Number(n))
            .filter((n: number) => Number.isInteger(n) && n > 0)
            .map((n: number) => (n % 2 === 1 ? n : n - 1)),
        ),
      ].sort((a: number, b: number) => a - b);
    if (typeof v.editor?.vim === "boolean") p.editor.vim = v.editor.vim; // an explicit boolean only — undefined must stay "unset", not read as off
    // Trimmed: it is typed by hand, and a trailing space resolves to nothing with no hint why.
    if (typeof v.stemsChain === "string" && v.stemsChain.trim())
      p.stemsChain = v.stemsChain.trim();
    if (typeof v.instrumentalChain === "string" && v.instrumentalChain.trim())
      p.instrumentalChain = v.instrumentalChain.trim();
    // Either form, like a track's `input`: the numbers, or a label this file's `channels.out` names.
    if (Array.isArray(v.cueOutput)) {
      const ch = v.cueOutput
        .map((n: any) => Number(n))
        .filter((n: number) => Number.isInteger(n) && n > 0);
      if (ch.length) p.cueOutput = ch;
    } else if (typeof v.cueOutput === "string" && v.cueOutput.trim())
      p.cueOutput = v.cueOutput.trim();
    // Lowercased, because ORT's provider names are and a `DML` here would match nothing in silence.
    if (Array.isArray(v.onnxProviders)) {
      const eps = v.onnxProviders
        .map((s: unknown) =>
          String(s ?? "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean);
      if (eps.length) p.onnxProviders = eps;
    }
    // A target whose URI this cannot copy to is DROPPED here, so no surface offers a dead button.
    if (Array.isArray(v.syncTargets)) {
      const seen = new Set<string>();
      const targets: SyncTarget[] = [];
      for (const raw of v.syncTargets) {
        const name = String(raw?.name ?? "").trim();
        const uri = String(raw?.uri ?? "").trim();
        if (!name || !uri || !parseSyncTarget(uri)) continue;
        // The NAME is the identity a caller sends back, so two of one would be ambiguous.
        if (seen.has(name)) continue;
        seen.add(name);
        targets.push({ name, uri });
      }
      if (targets.length) p.syncTargets = targets;
    }
  }
  return p;
}

export function loadPreferences(): Preferences {
  try {
    if (!existsSync(PREFS_PATH)) return empty();
    return normalizePreferences(parseYaml(readFileSync(PREFS_PATH, "utf8")));
  } catch {
    return empty(); // a malformed prefs file shouldn't break anything
  }
}

export function savePreferences(p: Preferences): void {
  mkdirSync(dirname(PREFS_PATH), { recursive: true });
  writeFileSync(PREFS_PATH, stringifyYaml(normalizePreferences(p)), "utf8");
}

// --- mutators (load, change, save; return the new prefs) ----------------------

export function setAudioDevice(name: string, type?: string): Preferences {
  const p = loadPreferences();
  p.audioDevice = name ? { name, ...(type ? { type } : {}) } : undefined;
  savePreferences(p);
  return p;
}

/** Remember whether the pair at `channel` is stereo — either half is accepted, the odd one stored. */
export function setInputPair(channel: number, stereo: boolean): Preferences {
  const p = loadPreferences();
  const first = channel % 2 === 1 ? channel : channel - 1;
  const rest = p.inputPairs.filter((n) => n !== first);
  p.inputPairs = stereo ? [...rest, first].sort((a, b) => a - b) : rest;
  savePreferences(p);
  return p;
}

/** Remember the headphone pair. An empty spec clears it — "this machine has nowhere to send a cue". */
export function setCueOutput(spec: string | number[] | undefined): Preferences {
  const p = loadPreferences();
  const want = Array.isArray(spec) ? spec : String(spec ?? "").trim();
  p.cueOutput = (Array.isArray(want) ? want.length : want) ? want : undefined;
  savePreferences(p);
  return p;
}

/** Remember what this machine separates ON. Empty clears it, back to the safe default. */
export function setOnnxProviders(eps: readonly string[]): Preferences {
  const p = loadPreferences();
  const want = eps.map((s) => s.trim().toLowerCase()).filter(Boolean);
  p.onnxProviders = want.length ? want : undefined;
  savePreferences(p);
  return p;
}

/** Remember where this machine may copy a set list. An empty list clears them all. */
export function setSyncTargets(targets: readonly SyncTarget[]): Preferences {
  const p = loadPreferences();
  // Through the normaliser, so a target written by a route is judged exactly as one read off disk.
  const kept = normalizePreferences({ syncTargets: targets }).syncTargets;
  p.syncTargets = kept?.length ? kept : undefined;
  savePreferences(p);
  return p;
}

/** Remember which chain separates. An empty ref clears it — "this machine separates nothing". */
export function setStemsChain(ref: string): Preferences {
  const p = loadPreferences();
  const want = ref.trim();
  p.stemsChain = want || undefined;
  savePreferences(p);
  return p;
}

/** Remember which chain gives the instrumental. An empty ref clears it, like `setStemsChain`. */
export function setInstrumentalChain(ref: string): Preferences {
  const p = loadPreferences();
  const want = ref.trim();
  p.instrumentalChain = want || undefined;
  savePreferences(p);
  return p;
}

export function setEditorVim(on: boolean): Preferences {
  const p = loadPreferences();
  p.editor.vim = on;
  savePreferences(p);
  return p;
}

// "Focusrite USB (ASIO)", or "(system default)" when nothing is configured.
export function formatAudioDevice(d: AudioDevicePref | undefined): string {
  if (!d) return "(system default)";
  return d.type ? `${d.name} (${d.type})` : d.name;
}

const sameSet = (a: number[], b: number[]) =>
  a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

export function setChannelLabel(
  dir: ChannelDir,
  ch: number[],
  label: string,
): Preferences {
  const p = loadPreferences();
  const list = p.channels[dir].filter((e) => !sameSet(e.ch, ch)); // replace any existing entry for these channels
  list.push({ ch: [...ch].sort((a, b) => a - b), label });
  list.sort((a, b) => a.ch[0] - b.ch[0]);
  p.channels[dir] = list;
  savePreferences(p);
  return p;
}

export function clearChannelLabel(dir: ChannelDir, ch: number[]): Preferences {
  const p = loadPreferences();
  p.channels[dir] = p.channels[dir].filter((e) => !sameSet(e.ch, ch));
  savePreferences(p);
  return p;
}

// --- helpers -----------------------------------------------------------------

// Parse a channel spec like "3+4" or "1" into channel numbers.
export function parseChannels(spec: string): number[] {
  return String(spec)
    .split("+")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
}

// "3+4 synth" for a group, "1 guitar" for a single channel.
export function formatChannel(e: ChannelLabel): string {
  return `${e.ch.join("+")} ${e.label}`;
}

// A one-line summary per direction, e.g. { in: "1 guitar · 3+4 synth", out: "1+2 monitors" }.
export function formatChannels(p: Preferences): { in: string; out: string } {
  const fmt = (list: ChannelLabel[]) => list.map(formatChannel).join(" · ");
  return { in: fmt(p.channels.in), out: fmt(p.channels.out) };
}

// A `input`/`cueOutput` spec -> physical channels; an unresolvable LABEL reports itself rather than playing wrongly.
function resolveChannels(
  dir: ChannelDir,
  spec: string | number[] | undefined,
  p: Preferences,
): { channels: number[]; unknownLabel?: string } {
  if (spec == null) return { channels: [] };
  if (Array.isArray(spec))
    return {
      channels: spec.map(Number).filter((n) => Number.isInteger(n) && n > 0),
    };
  const label = String(spec);
  if (!label) return { channels: [] };
  const hit = p.channels[dir].find((c) => c.label === label);
  return hit
    ? { channels: [...hit.ch] }
    : { channels: [], unknownLabel: label };
}

// A track's `input` -> physical channels; an unresolvable LABEL reports itself rather than monitoring wrongly.
export function resolveInput(
  input: string | number[] | undefined,
  p: Preferences,
): { channels: number[]; unknownLabel?: string } {
  return resolveChannels("in", input, p);
}

/** The `CUE` bus's pair -> physical channels, against the OUT labels. Empty means this machine has no headphone pair. */
export function resolveCueOutput(p: Preferences): {
  channels: number[];
  unknownLabel?: string;
} {
  return resolveChannels("out", p.cueOutput, p);
}
