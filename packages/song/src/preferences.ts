// preferences.ts — the user's GLOBAL preferences (~/.studio/preferences.yaml): machine and rig config that
// spans every project, unlike the per-project song files. The default audio interface the engine opens, plus
// human-readable labels for its channels — labels are for reading only, unrelated to track names.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export const PREFS_PATH = join(homedir(), ".studio", "preferences.yaml");

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
  /**
   * Which interface inputs are grouped into STEREO devices, as the 1-based FIRST channel of each
   * pair — `[1, 5]` means 1+2 and 5+6 are stereo and everything else is mono.
   *
   * The rig's own wiring, so it lives here beside the interface rather than in any song. It is
   * replayed to the engine on every connect exactly as `audioDevice` is (engineLink), and for the
   * same reason: the engine keeps no memory of a device choice, and Tracktion's own copy of this
   * one is only readable through the call that reopens the remembered interface — the one thing
   * `engine/moteur/AGENTS.md` forbids. See engine/moteur/docs/audioDevice.md.
   *
   * Only the FIRST of a pair is stored because only it can be: the interface pairs even/odd
   * hardware channels, so 2 names the same pair as 1 and there is no pair 2+3 to describe.
   */
  inputPairs: number[];
  editor: EditorPref;
  /**
   * The chain that SEPARATES a record into stems — `@st0/stems`.
   *
   * Here rather than in a project, and asked for ONCE rather than at each use. Which module
   * separates and which model it wants is a fact about the library and the machine — the same
   * answer for every playlist, every set and every clip — so a screen that asked for it would be
   * asking the same question of the same person every time. A set still says WHETHER its desk
   * catches up on an unprepared record (`stems: true` on its surface); it no longer says which
   * chain, because that was never its business.
   *
   * Optional: a machine that separates nothing has no chain, and every caller says so with the
   * command that sets one rather than failing halfway through a set list.
   */
  stemsChain?: string;
}

// The defaults, in ONE place — every other module builds on this rather than its own literal.
export const defaultPreferences = (): Preferences => ({
  channels: { in: [], out: [] },
  inputPairs: [],
  editor: { vim: true },
});
const empty = defaultPreferences;

// Coerce a parsed object into a well-formed Preferences (tolerant of hand-edits). Exported so the
// coercion can be tested on its own: it is what every hand-edit of this file passes through, and
// reaching it via loadPreferences would mean reading the real ~/.studio of whoever runs the suite.
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
    // Normalised to the ODD channel of each pair and deduplicated: a hand-edit saying `[2]` means
    // the pair 1+2, which is the same pair `[1]` names, and the engine would round it down anyway.
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
    // Trimmed, because it is typed by hand as often as it is picked, and a trailing space in a
    // chain ref resolves to nothing with no hint as to why.
    if (typeof v.stemsChain === "string" && v.stemsChain.trim())
      p.stemsChain = v.stemsChain.trim();
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

/**
 * Remember that the pair starting at `channel` is stereo, or that it is not.
 *
 * Takes either half and stores the odd one, so a caller holding "channel 2" does not have to know
 * the interface's pairing rule to record what it just did.
 */
export function setInputPair(channel: number, stereo: boolean): Preferences {
  const p = loadPreferences();
  const first = channel % 2 === 1 ? channel : channel - 1;
  const rest = p.inputPairs.filter((n) => n !== first);
  p.inputPairs = stereo ? [...rest, first].sort((a, b) => a - b) : rest;
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

// A track's `input` -> physical channels: a list already is, a string is a MACHINE-level label (so one project
// resolves differently per rig). Unresolvable reports `unknownLabel` rather than monitoring the wrong input.
export function resolveInput(
  input: string | number[] | undefined,
  p: Preferences,
): { channels: number[]; unknownLabel?: string } {
  if (input == null) return { channels: [] };
  if (Array.isArray(input))
    return {
      channels: input.map(Number).filter((n) => Number.isInteger(n) && n > 0),
    };
  const label = String(input);
  if (!label) return { channels: [] };
  const hit = p.channels.in.find((c) => c.label === label);
  return hit
    ? { channels: [...hit.ch] }
    : { channels: [], unknownLabel: label };
}
