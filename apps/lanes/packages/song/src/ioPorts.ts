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
  loadProjectRoot,
  splitModuleKey,
} from "./loader";
import { loadPreferences, type Preferences, resolveInput } from "./preferences";

export interface IoPort {
  /** How a chain names it: "OUT" for a local module, "@engine/io/IN:in-1" for an inherited instance. */
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
  /** The generic io module rather than one of its instances. It declares no channel of its own. */
  generic: boolean;
}

/** Split "@engine/io/IN:in-1" into its namespace and the part worth showing. */
function describe(ref: string): { name: string; namespace: string } {
  const ns = ref.startsWith("@") ? ref.slice(1).split("/")[0] : "";
  const path = ref.startsWith("@") ? ref.split("/").slice(2).join("/") : ref;
  return { name: path || ref, namespace: ns };
}

/**
 * Every io module the project can reach, inputs first, each in ref order.
 *
 * `prefs` is injected so this is testable without the machine's preferences file — the
 * labels are a property of the RIG, and a test has no rig.
 */
export function ioPorts(dir: string, prefs?: Preferences): IoPort[] {
  let from: string[] = [];
  try {
    const mf = loadProjectRoot(dir)?.project?.modules_from;
    if (Array.isArray(mf)) from = mf.map(String);
  } catch {
    /* no project header — the project's own io modules still list */
  }
  type Io = { kind?: string; io?: string; channel?: unknown };
  let refs: Record<string, Io>;
  try {
    refs = loadModuleRefs(dir, from);
  } catch {
    refs = loadModuleRefs(dir, []); // a broken inherited folder costs its ports, not the panel
  }
  // …plus the project's OWN io modules, which the ref map deliberately leaves out: it
  // skips local instances, and an input IS an instance now. `IN:in-2` — the thing that
  // carries the channel, the monitoring and the trim — lives in the song that records
  // through it, so the panel that meters it has to look there.
  let local: Record<string, Io> = {};
  try {
    local = loadModules(dir) as Record<string, Io>;
  } catch {
    /* a broken module costs its port, not the panel */
  }
  for (const [key, m] of Object.entries(local))
    if (m?.kind === "io" && !refs[key]) refs[key] = m;
  const p = prefs ?? loadPreferences();

  const ports: IoPort[] = [];
  for (const [ref, m] of Object.entries(refs)) {
    if (m?.kind !== "io") continue;
    const dirn = m.io === "in" ? "in" : "out";
    const authored = m.channel as string | number[] | undefined;
    const r = resolveInput(authored, p);
    ports.push({
      ref,
      ...describe(ref),
      dir: dirn,
      channels: r.channels,
      label: typeof authored === "string" ? authored : undefined,
      unknownLabel: r.unknownLabel != null || undefined,
      // A generic sits at the head of its folder; its instances are what carry channels.
      generic: !splitModuleKey(ref).instance,
    });
  }
  // Inputs first (that is the order the panel reads in), then by ref so the list is stable
  // across reloads — an instance list that reshuffles is unreadable while it moves.
  return ports.sort((a, b) =>
    a.dir === b.dir ? a.ref.localeCompare(b.ref) : a.dir === "in" ? -1 : 1,
  );
}
