// strudel.ts — evaluate Strudel (TidalCycles' JS port) pattern files and query them
// over a cycle window into timed events, for patternClock.ts to stream onto engine
// tracks. Pinned to @strudel/* 1.1.x: 1.2+ pulls in a browser-only synth
// (@kabelsalat/web) that won't load headless in Node.

/// <reference path="./strudel-shims.d.ts" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-ignore — @strudel/* ship no types; shimmed for this package, ignored so others can compile it too.
import { evalScope } from "@strudel/core";
// @ts-ignore
import { evaluate } from "@strudel/transpiler";
import { loadLanes } from "@studio/song/loader";
import type { Lane } from "@studio/song/trackModule";
import { queryEvents, type StrudelEvent } from "./events";

export { fallbackPitch, hapPitch, type StrudelEvent } from "./events";

// A track that declares itself the destination of one of a pattern's lanes.
export interface StrudelLane {
  track: string; // the declaring track's id — a real, chainable, mixable track
  label: string; // the lane it claims: the track's name, defaulting to its id
  // No `contentType`: a lane is not typed, so how an event reads is the EVENT's business.
}

// A pattern file and everything the project declares about it.
export interface StrudelLink {
  path: string; // absolute
  lanes: StrudelLane[]; // the tracks fed by this file, by declaration order (id)
  // Where this file's UNDECLARED lanes hang — the group they join and the scope keying their ids.
  group: string; // shared by every declaring track ('' if none, or if they differ)
  key: string; // a stable id fragment for this file (its slugged basename)
}

// The pattern files this project actually plays — ONE link per file, carrying every track that claims a lane of it.
export function strudelPatterns(dir: string): StrudelLink[] {
  let tracks: Record<string, Lane>;
  try {
    tracks = loadLanes(dir) ?? {};
  } catch {
    return []; // a project that doesn't evaluate has no patterns to play yet
  }
  const groupOf: Record<string, string> = {};
  for (const [id, t] of Object.entries(tracks))
    if (t.type === "group") for (const m of t.tracks) groupOf[m] = id;

  const byPath = new Map<string, StrudelLink>();
  for (const [track, t] of Object.entries(tracks).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    // An engine-clocked lane is the engine's to play: streaming it too would double every note.
    if (
      t.type !== "strudel" ||
      !t.strudel ||
      t.disabled ||
      t.clock === "engine"
    )
      continue;
    const path = resolve(dir, t.strudel);
    const link = byPath.get(path) ?? {
      path,
      lanes: [],
      group: groupOf[track] ?? "",
      key: patternKey(path),
    };
    // Undeclared lanes can only hang under a group the whole file agrees on.
    if (link.lanes.length && link.group !== (groupOf[track] ?? ""))
      link.group = "";
    link.lanes.push({
      track,
      // The lane's name is its node file's, so the label and the id are one string.
      label: track,
    });
    byPath.set(path, link);
  }
  return [...byPath.values()];
}

// The pattern files an ENGINE-clocked lane plays, absolute: a save of one must re-send the document, not the clock's window.
export function enginePatternFiles(dir: string): string[] {
  let tracks: Record<string, Lane>;
  try {
    tracks = loadLanes(dir) ?? {};
  } catch {
    return [];
  }
  const out = new Set<string>();
  for (const t of Object.values(tracks))
    if (
      t.type === "strudel" &&
      t.strudel &&
      !t.disabled &&
      t.clock === "engine"
    )
      out.add(resolve(dir, t.strudel));
  return [...out];
}

// An id fragment scoping the live tracks a pattern mints — the basename is enough, since links are deduped by path.
function patternKey(path: string): string {
  const base = path.replace(/^.*[\\/]/, "").replace(/\.strudel$/, "");
  return (
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "pattern"
  );
}

// Register the pattern functions + the mini-notation string parser once, lazily.
let scopeReady: Promise<unknown> | null = null;
function ensureScope(): Promise<unknown> {
  // @ts-ignore — dynamic import of the untyped @strudel/* packages
  return (scopeReady ??= evalScope(
    import("@strudel/core"),
    import("@strudel/mini"),
  ));
}

export interface StrudelPattern {
  path: string;
  orbits: number[]; // the orbits this pattern uses (discovered by sampling)
  query(fromCycle: number, toCycle: number): StrudelEvent[];
}

// Load + evaluate a .strudel file into a queryable pattern; throws on a bad file (querying a valid one never throws).
export async function loadPattern(path: string): Promise<StrudelPattern> {
  await ensureScope();
  const code = readFileSync(path, "utf8");
  const { pattern } = await evaluate(code);

  const query = (from: number, to: number): StrudelEvent[] =>
    queryEvents(pattern, from, to);

  const orbits = [...new Set(query(0, 8).map((e) => e.orbit))];
  if (!orbits.length) orbits.push(0);
  return { path, orbits, query };
}
