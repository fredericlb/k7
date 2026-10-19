// shared.ts — what several VERB GROUPS need and none of them owns: argument splitting, the
// event a timecode names, the renderer, a playlist's path. A verb file imports values from
// here or another verb file, never from `commands.ts`, which imports every verb file; only
// erased TYPES come from `commands.ts`. See docs/verbs.md.

import { resolve } from "node:path";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import {
  isInputModule,
  isMidiInModule,
  type loadGraph,
} from "@studio/song/graph";
import type { ProjectDoc } from "@studio/song/project";
import { PLAYLISTS_DIR, playlistPathOf } from "@studio/song-schema/playlist";
import { parsePosition } from "@studio/song-schema/timecode";
import { localRenderer, type Renderer } from "@studio/take-render/renderer";
import { isWithin } from "@studio/web-protocol/paths";
import type { CommandHost } from "../commands.ts";

/** What the playlist verbs say with no workspace: they never fall back to `songPath`, docs/playlist.md. */
const NO_WORKSPACE =
  "no workspace here — a playlist lives in the repository's _playlists/";

/** A command line's words — named because `node automate` once split on `/s+/`, the LETTER `s`. */
export function splitWords(a: string): string[] {
  return a.trim().split(/\s+/).filter(Boolean);
}

/** Where a playlist NAME lands, or a refusal — a workspace and containment, docs/playlist.md. */
export function playlistFile(
  name: string,
  h: CommandHost,
): { rel: string; abs: string } | null {
  const root = h.repoDir;
  if (!root) {
    h.refuse([NO_WORKSPACE]);
    return null;
  }
  // A set list is a .k7x file: a YAML name would only become `<name>.yaml.k7x`.
  if (/\.ya?ml$/i.test(name.trim())) {
    h.refuse([`'${name}': a playlist is a .k7x file — name it without .yaml`]);
    return null;
  }
  const rel = playlistPathOf(name);
  const dir = resolve(root, PLAYLISTS_DIR);
  const abs = rel ? resolve(root, rel) : "";
  if (!rel || !isWithin(dir, abs)) {
    h.refuse([
      `'${name}' is not a playlist name — it would leave ${PLAYLISTS_DIR}/`,
    ]);
    return null;
  }
  return { rel, abs };
}

/** Does the signal ARRIVING at `node` come off a live input, audio or MIDI? Walks UPSTREAM — docs/verbs.md. */
export function runCarriesInput(
  g: ReturnType<typeof loadGraph>,
  node: string,
): boolean {
  const bare = (s: string) => s.split("#")[0];
  const isLive = (name: string): boolean => {
    const b = g.modules[name];
    // A MIDI device lands on a lane too, its notes being what recording there captures (packages/song/docs/midiIn.md).
    return !!b && (isInputModule(g, b) || isMidiInModule(b));
  };
  // Who feeds whom: a chain is a linear run, and its `out` is how one chain reaches another.
  const feeders = new Map<string, string[]>();
  const link = (from: string, to: string): void => {
    const at = feeders.get(bare(to));
    if (at) at.push(bare(from));
    else feeders.set(bare(to), [bare(from)]);
  };
  for (const c of Object.values(g.chains)) {
    const run = [...(c.from ? [c.from] : []), ...c.use.map((s) => s.module)];
    for (let i = 1; i < run.length; i++) link(run[i - 1], run[i]);
    const last = run[run.length - 1];
    if (last) for (const o of c.out) link(last, o.to);
  }
  // …then back up from `node`, itself included; `seen` is not an optimisation, a graph may hold a cycle.
  const seen = new Set<string>();
  const stack = [bare(node)];
  while (stack.length) {
    const n = stack.pop() as string;
    if (seen.has(n)) continue;
    seen.add(n);
    if (isLive(n)) return true;
    for (const f of feeders.get(n) ?? []) stack.push(f);
  }
  return false;
}

/** The host's renderer, else this machine's engine binary; null when neither can render. */
export function rendererOf(h: Pick<CommandHost, "renderer">): Renderer | null {
  if (h.renderer) return h.renderer;
  const bin = findEngineBinary();
  return bin ? localRenderer(bin) : null;
}

/** The first argument, JSON-quoted or bare, and the rest: JSON is what a Windows path survives — packages/song/docs/recorderNode.md. */
export function firstArg(a: string): { head: string; rest: string } | null {
  const quoted = /^"(?:[^"\\]|\\.)*"/.exec(a);
  if (quoted) {
    try {
      return {
        head: JSON.parse(quoted[0]) as string,
        rest: a.slice(quoted[0].length).trim(),
      };
    } catch {
      return null;
    }
  }
  const bare = /^\S+/.exec(a);
  return bare ? { head: bare[0], rest: a.slice(bare[0].length).trim() } : null;
}

/** An optional trailing `<x>,<y>` — where the cursor was, so a created node is BORN there; docs/verbs.md. */
export function takeSpawnAt(parts: string[]): { x: number; y: number } | null {
  const last = parts[parts.length - 1];
  const m = last ? /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(last) : null;
  if (!m) return null;
  parts.pop();
  return { x: Number(m[1]), y: Number(m[2]) };
}

export function uniqueId(base: string, project: ProjectDoc): string {
  const ids = new Set(project.tracks.map((t) => t.id));
  let n = 1;
  while (ids.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** The track + the event sitting at `atTc`, or null with the reason already logged; the three `event` commands share it. */
export function resolveEvent(
  h: CommandHost,
  trackArg: string,
  atTc: string,
  // Set by the verbs that rewrite ONE material's window: a comped event is several (song docs/takes.md).
  refuseComp = false,
): {
  track: ProjectDoc["tracks"][number];
  atBeats: number;
  hit: ProjectDoc["tracks"][number]["clips"][number];
  num: number;
  den: number;
  tempo: number; // a resize converts beats into the seconds a clip's window is written in
} | null {
  const p = h.project();
  const track = p.tracks.find((t) => t.id === trackArg || t.name === trackArg);
  if (!track) {
    h.refuse([
      `no track "${trackArg}"${p.tracks.length ? ` — try: ${p.tracks.map((t) => t.id).join(", ")}` : ""}`,
    ]);
    return null;
  }
  const num = p.timeSigNumerator;
  const den = p.timeSigDenominator;
  let atBeats: number;
  try {
    atBeats = parsePosition(atTc, num, den);
  } catch (e) {
    h.refuse([`bad timecode: ${(e as Error).message}`]);
    return null;
  }
  const hit = track.clips.find((c) => Math.abs(c.start - atBeats) < 1e-6);
  if (!hit) {
    h.refuse([`no event on '${track.id}' at ${atTc}`]);
    return null;
  }
  if (refuseComp && hit.comp) {
    h.refuse([
      `the event at ${atTc} is comped from its takes — edit it in its takes view`,
    ]);
    return null;
  }
  return { track, atBeats, hit, num, den, tempo: p.tempo };
}

/** A tap's arguments: whitespace-separated, a "quoted" one kept whole — a sample's path holds spaces. */
export function splitArgs(a: string): string[] {
  return [...a.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
}
