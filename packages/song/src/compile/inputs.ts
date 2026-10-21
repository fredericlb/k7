// compile/inputs.ts — what a compile reads: the project's files loaded once, the references
// they make checked before anything is built, and each track's live input. What a reader gets
// wrong: a missing MODULE is not fatal here, a missing clip or library ref is.
// Part of nodeProject.ts's compile — docs/nodeProject.md.

import { resolve } from "node:path";
import { loadLinkLevels } from "../chainProject";
import { busOnlyOf, bypassedOf } from "../chainsGraph";
import { confineTo, projectRoots } from "../confine";
import {
  type Chain,
  checkChainInputs,
  inputLandingTrack,
  parseChains,
} from "../graph";
import { applyLinkLevels } from "../linkLevels";
import {
  type Diagnostic,
  loadChains,
  loadModuleRefs,
  loadModules,
  loadProjectRoot,
  loadVideoTracks,
  readYamlEntities,
  withChainModuleRefs,
} from "../loader";
import { resolveModuleMap } from "../moduleResolve";
import { monitorMode } from "../monitorMode";
import {
  defaultPreferences,
  loadPreferences,
  type Preferences,
  resolveInput,
} from "../preferences";
import type { RawClip, RawPlacement, RawSequence } from "../rawDoc";
import { tapFeedsOf, tapPairs } from "../tapOuts";
import { lanesOf } from "../trackModule";
import { wsExists } from "../yaml/workspaceFile";
import type { ChainOwnership } from "./ownership";
import { fixedFieldsOf, type RawTimeline } from "./timelines";

/** Everything the compile reads off disk, read once — the rest of it is pure over this. */
export type CompileInputs = ReturnType<typeof loadCompileInputs>;

/** Read the project the compile works on — see docs/nodeProject.md. */
export function loadCompileInputs(dir: string) {
  // The rig, not the song — unreadable preferences mean no labels resolve, never a failed compile.
  let prefs: Preferences;
  try {
    prefs = loadPreferences();
  } catch {
    prefs = defaultPreferences();
  }
  const root = loadProjectRoot(dir, true); // the root file -> project, markers
  // What a path in this project's files may reach — docs/confine.md.
  const roots = projectRoots(dir);
  const rawChains = loadChains(dir, root, true);
  const localModules = loadModules(dir, true); // validated as read — this doc feeds the engine
  // Read WITH their issues: a rejected library module is dropped, and without its complaint the symptom is "extends unknown module".
  const refIssues: Diagnostic[] = [];
  const moduleRefs = loadModuleRefs(dir, undefined, refIssues); // the `extends` vocabulary
  // The LANES, before the chains, folded from the local modules alone — see docs/graphModel.md.
  const lanesMap = lanesOf(resolveModuleMap(localModules, moduleRefs));
  // The PICTURE lanes, read unvalidated and for their NAMES only: they are lanes in the derivation, as buildGraph has them.
  const videoLanes = loadVideoTracks(dir);
  const chains: Record<string, Chain> = parseChains(
    rawChains,
    (n) => n in lanesMap || n in videoLanes,
  ); // keyed by each head's resolved name
  // A chain project's link levels, which segments cannot carry: a send to a bus plays at its level (docs/chainFiles.md).
  applyLinkLevels(chains, loadLinkLevels(dir));
  // A lane's MUTE, from the one place a bypass is written.
  const bypassed = bypassedOf(rawChains);
  // Kept apart from `bypassed` on purpose: one says the module is off, the other where the signal goes.
  const busOnly = busOnlyOf(rawChains);
  // Taps of a rack node that leave by a pair of their own, each feeding a subchain's run (docs/racks.md).
  const routedTaps = tapPairs(tapFeedsOf(rawChains));
  // Read WITH their issues: a rejected clip is dropped from the map, and its own complaint is what stops the ref reading as "not found".
  const clipsRead = readYamlEntities(dir, "clips");
  const clipsMap = clipsRead.values as Record<string, RawClip>;
  const seqsRead = readYamlEntities(dir, "sequences");
  const seqMap = seqsRead.values as Record<string, RawSequence>;
  // Timelines placed whole as one event — docs/timelines.md.
  const timelinesRead = readYamlEntities(dir, "timelines");
  const timelinesMap = timelinesRead.values as Record<string, RawTimeline>;
  // Plus the shared modules the chains name by ref, resolved ONCE so the compile loop below reads plain fields.
  const modulesMap = resolveModuleMap(
    withChainModuleRefs(localModules, moduleRefs, chains),
    moduleRefs,
  );
  return {
    prefs,
    root,
    roots,
    rawChains,
    localModules,
    refIssues,
    moduleRefs,
    lanesMap,
    videoLanes,
    chains,
    bypassed,
    busOnly,
    routedTaps,
    clipsRead,
    clipsMap,
    seqsRead,
    seqMap,
    timelinesRead,
    timelinesMap,
    modulesMap,
  };
}

/** Unresolved references and miswired ports fail loudly rather than being silently dropped — see docs/nodeProject.md. */
export function checkReferences(dir: string, inp: CompileInputs): void {
  const {
    roots,
    rawChains,
    refIssues,
    moduleRefs,
    lanesMap,
    videoLanes,
    chains,
    clipsRead,
    clipsMap,
    seqsRead,
    seqMap,
    timelinesRead,
    timelinesMap,
    modulesMap,
  } = inp;
  const refErrs: string[] = [];
  for (const [, c] of Object.entries(chains))
    for (const step of c.use) {
      const moduleName = String(step?.module ?? "");
      const module = modulesMap[moduleName];
      // A missing module is NOT fatal: it compiles to nothing, like a bypassed step, and the graph draws a `?`.
      if (!module) continue;
      const ext = String(module.extends ?? "");
      if (ext && !moduleRefs[ext]) {
        // On disk but unreadable is a different fault from absent, and only the file's own complaint says which line is wrong.
        const broke = refIssues.find((i) => i.file.startsWith(`${ext}/`));
        refErrs.push(
          broke
            ? `module '${moduleName}': extends '${ext}', which ${broke.message}`
            : `module '${moduleName}': extends unknown module '${ext}'`,
        );
      }
    }
  // One event's checks, `where` naming its lane — a project lane, or a timeline's.
  const checkEvent = (where: string, p: RawPlacement, inside: string[]) => {
    const ref = String(p?.ref ?? "");
    if (!ref) return;
    const timeline = timelinesMap[ref];
    if (timeline) {
      if (inside.includes(ref)) {
        refErrs.push(
          `${where}: timeline '${ref}' is placed inside itself (${[...inside, ref].join(" > ")})`,
        );
        return;
      }
      const fixed = fixedFieldsOf(p);
      if (fixed.length)
        refErrs.push(
          `${where}: timeline '${ref}' is placed with ${fixed.join(", ")} — a timeline event's extent is its timeline's length, fixed`,
        );
      for (const lane of timeline.lanes)
        for (const e of lane.events ?? [])
          checkEvent(`timeline '${ref}' lane '${lane.lane}'`, e, [
            ...inside,
            ref,
          ]);
      return;
    }
    {
      const clip = clipsMap[ref];
      const seq = seqMap[ref];
      if (!clip && !seq) {
        // A file that EXISTS but failed to load is reported with its own complaint instead of "not found".
        const brokeClip = clipsRead.issues.find((i) =>
          i.startsWith(`clips/${ref}.`),
        );
        const brokeSeq = seqsRead.issues.find((i) =>
          i.startsWith(`sequences/${ref}.`),
        );
        refErrs.push(
          brokeClip
            ? `${where}: clip '${ref}' failed to load — ${brokeClip}`
            : brokeSeq
              ? `${where}: sequence '${ref}' failed to load — ${brokeSeq}`
              : `${where}: clip/sequence '${ref}' not found`,
        );
      } else if (
        clip?.source &&
        !confineTo(roots, resolve(dir, String(clip.source)))
      )
        refErrs.push(
          `${where}: audio clip '${ref}' names a file outside the project (${clip.source})`,
        );
      else if (
        clip &&
        !(clip.source && wsExists(resolve(dir, String(clip.source))))
      )
        refErrs.push(
          `${where}: audio clip '${ref}' file missing (${clip.source ?? "?"})`,
        );
      // A sequence's notes are inline — its presence in seqMap is the whole check.

      // A trim is a CLIP gain, which only audio has: a MIDI event shares its lane's instrument (song-edit docs/eventGain.md).
      if (!clip && seq && Number(p?.gain ?? 0) !== 0)
        refErrs.push(
          `${where}: sequence '${ref}' is placed with a gain, which only an audio event has — its notes' velocities are the way to change it`,
        );
      // Repeating needs a known end — the clip's `to` or the event's own, the window being the two intersected (docs/graphModel.md).
      const loops = Number(p?.loop ?? 1);
      if (clip && loops > 1 && clip.to == null && p?.to == null)
        refErrs.push(
          `${where}: clip '${ref}' is placed with loop: ${loops}, but neither it nor the event says 'to' — a repeat needs the window's end`,
        );
    }
  };
  for (const [trackId, t] of Object.entries(lanesMap))
    for (const p of t.events) checkEvent(`track '${trackId}'`, p, []);
  // A timeline placed nowhere is still checked: its own view plays what it holds.
  for (const [id, t] of Object.entries(timelinesMap))
    for (const lane of t.lanes)
      for (const e of lane.events ?? [])
        checkEvent(`timeline '${id}' lane '${lane.lane}'`, e, [id]);
  for (const issue of timelinesRead.issues)
    refErrs.push(`timeline failed to load — ${issue}`);
  // The pattern file must exist; whether it HAS the named lane needs it evaluated, so the engine reports that.
  for (const [trackId, t] of Object.entries(lanesMap))
    if (t.strudel && !wsExists(resolve(dir, t.strudel)))
      refErrs.push(
        `track '${trackId}': strudel pattern '${t.strudel}' file missing`,
      );

  // `video_tracks/` is deliberately unchecked here — the picture compiles separately (packages/song-video/docs/picture.md).

  if (refErrs.length)
    throw new Error(
      `unresolved reference(s):\n  - ${[...new Set(refErrs)].join("\n  - ")}`,
    );

  // Reject a project whose chains don't feed their modules' declared input ports.
  const inputErrs = checkChainInputs(
    chains,
    modulesMap,
    lanesMap,
    clipsMap,
    seqMap,
    // …which is also what feeds a fade's stretch (song-video/docs/transitions.md).
    videoLanes,
    new Set(tapFeedsOf(rawChains).map((f) => f.to)),
  );
  if (inputErrs.length)
    throw new Error(
      `module input wiring invalid:\n  - ${inputErrs.join("\n  - ")}`,
    );
}

// Input trim in dB. Non-finite (or absent) is unity — a gain the file can't state is not a reason to change one.
function normGain(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Each track's live input — an io "in" module collapsed onto the track its chain lands on. */
export function liveInputsOf(
  inp: CompileInputs,
  own: ChainOwnership,
): Record<string, { channels: number[]; monitor: string; gain: number }> {
  const { prefs, chains, lanesMap, modulesMap } = inp;
  const { ownerOf } = own;
  // An io "in" module is wired by the CHAIN it sits in, and the engine's model is the reverse, so each collapses onto its track.
  const inputOf: Record<
    string,
    { channels: number[]; monitor: string; gain: number }
  > = {};
  for (const [name, c] of Object.entries(chains)) {
    // The INPUT first, then the track it lands on: the other way round skipped every chain with no owner.
    const b = c.use
      .map((s) => modulesMap[s?.module])
      .find((m) => m?.io === "in");
    if (!b) continue;
    const track =
      ownerOf(name, c) || inputLandingTrack(c, (id) => !!lanesMap[id]);
    if (!track || inputOf[track]) continue;
    inputOf[track] = {
      // The seam cast: `channel` passed the module schema (a label or channel list).
      channels: resolveInput(b.channel as string | number[] | undefined, prefs)
        .channels,
      // The engine's vocabulary has no "absent": a file that says nothing monitors "auto".
      monitor: monitorMode(b.monitor) ?? "auto",
      gain: normGain(b.gain),
    };
  }
  return inputOf;
}
