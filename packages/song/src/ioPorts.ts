// ioPorts.ts — the project's declared I/O: every module under an `io/` type folder, its
// own and the inherited ones (project.modules_from — a workspace's shared `_modules/io`,
// which is where `module populate` files one input per interface channel).
//
// Read for the I/O panel, which lists what a song CAN take in and put out and meters it.
// Kept apart from hints.ts on purpose: hints are a completion vocabulary — names, no
// substance — and a port needs its channels resolved to talk to the engine.

import {
  loadModuleRefs,
  loadModules,
  splitModuleKey,
  withModuleStamp,
} from "./loader";
import { resolveModule } from "./moduleResolve";
import { nodePlaces } from "./nodePlace";
import { loadPreferences, type Preferences, resolveInput } from "./preferences";
import type { LoadedModule } from "./rawDoc";

export interface IoPort {
  /** How a chain names it: "OUT" for a local module, "@engine/io/IN:in-1" for an inherited node. */
  ref: string;
  /** The last segment, for display — "IN:in-1" out of "@engine/io/IN:in-1". */
  name: string;
  dir: "in" | "out";
  /** Interface channels, resolved (a preferences label becomes its numbers). Empty when undeclared. */
  channels: number[];
  /** The `channel:` as AUTHORED, when it names a preferences label — shown, since that is what the file says. */
  label?: string;
  /** The label named no known input: declared, but this rig cannot say which channel it is. */
  unknownLabel?: boolean;
  /** Where it comes from — a shared catalogue's namespace, or "" for one of the project's own. */
  namespace: string;
  /** The generic io module rather than one of its nodes. It declares no channel of its own. */
  generic: boolean;
}

/** Split "@engine/io/IN:in-1" into its namespace and the part worth showing. */
function describe(ref: string): { name: string; namespace: string } {
  const ns = ref.startsWith("@") ? ref.slice(1).split("/")[0] : "";
  const path = ref.startsWith("@") ? ref.split("/").slice(2).join("/") : ref;
  return { name: path || ref, namespace: ns };
}

/** Every io module the project can reach, inputs first; `prefs` is injected because a test has no rig. */
export function ioPorts(dir: string, prefs?: Preferences): IoPort[] {
  return withModuleStamp(dir, () => ioPortsIn(dir, prefs));
}

// Reads twice, so one stamp walk covers the pair as compileNodeProject does (docs/moduleCache.md).
function ioPortsIn(dir: string, prefs?: Preferences): IoPort[] {
  type Io = { kind?: string; io?: string; channel?: unknown };
  // No try/catch left: a shared root is found by location, so a missing folder is simply not one.
  const byRef = loadModuleRefs(dir);
  const refs: Record<string, Io> = { ...byRef };
  // …plus the project's OWN io nodes, which the ref map leaves out because an input IS a node.
  let local: Record<string, LoadedModule> = {};
  try {
    local = loadModules(dir);
  } catch {
    /* a broken module costs its port, not the panel */
  }
  // RESOLVED, since a node `extends: "@meta/IN"` is an input only through what it extends.
  for (const [key, m] of Object.entries(local)) {
    if (refs[key]) continue;
    let r: Io = m as Io;
    try {
      r = resolveModule(m, byRef) as Io;
    } catch {
      /* an unresolvable node is read as written */
    }
    if (r?.kind === "io") refs[key] = r;
  }
  // A chain project's node is named by an id: what a person reads is where it sits (nodePlace.ts).
  const places = nodePlaces(dir);
  const p = prefs ?? loadPreferences();

  const ports: IoPort[] = [];
  for (const [ref, m] of Object.entries(refs)) {
    if (m?.kind !== "io") continue;
    // Only AUDIO ports: a file, a lens or a MIDI device is an io module with no channel to meter.
    if (m.io !== "in" && m.io !== "out") continue;
    const dirn = m.io === "in" ? "in" : "out";
    const authored = m.channel as string | number[] | undefined;
    const r = resolveInput(authored, p);
    const shown = describe(ref);
    ports.push({
      ref,
      ...shown,
      ...(places[ref] ? { name: places[ref].place } : {}),
      dir: dirn,
      channels: r.channels,
      label: typeof authored === "string" ? authored : undefined,
      unknownLabel: r.unknownLabel != null || undefined,
      // A generic sits at the head of its folder; its nodes are what carry channels — and a chain node is never one.
      generic: !places[ref] && !splitModuleKey(ref).node,
    });
  }
  // Inputs first, then by ref, so the panel's list does not reshuffle across reloads.
  return ports.sort((a, b) =>
    a.dir === b.dir ? a.ref.localeCompare(b.ref) : a.dir === "in" ? -1 : 1,
  );
}
