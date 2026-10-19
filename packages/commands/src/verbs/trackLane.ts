// trackLane.ts — a lane's own verbs: create, order, mute / solo, and its automation
// lanes. See docs/verbs.md.

import { join } from "node:path";
import { createFlatCurveFile } from "@studio/song/curves";
import { loadGraph } from "@studio/song/graph";
import {
  createTrackFile,
  loadProjectRoot,
  setLaneOrder,
} from "@studio/song/loader";
import type { ProjectDoc, TrackDoc } from "@studio/song/project";
import { addTrackMixer } from "@studio/song/trackMixerFile";
import { deleteFileValue, setFileValue } from "@studio/song/yaml/edit";
import {
  setModuleAutomationBinding,
  setModuleBypass,
} from "@studio/song-edit/projectEdit";
import { builtinParamsFor } from "@studio/song-schema/builtinParams";
import { curveRef, splitPort } from "@studio/song-schema/moduleTypes";
import { beatsToPosition } from "@studio/song-schema/timecode";
import { orderPosition, reorderTracks } from "@studio/song-schema/trackKind";
import type { CommandHost, SidHandler } from "../commands.ts";
import { splitWords, uniqueId } from "./shared.ts";

// `track new [name]`, falling back to the next free track-N; a lane has no kind — docs/verbs.md.
async function newTrack(arg: string, h: CommandHost): Promise<void> {
  const name = arg.trim().split(/\s+/)[0] ?? "";
  const id = name || uniqueId("track", h.project());
  try {
    const written = createTrackFile(h.songPath, id);
    // …and its STRIP, which a lane with nowhere to wire one is SAID to lack rather than refused for.
    let strip: string[] = [];
    let noStrip = "";
    try {
      strip = addTrackMixer(h.songPath, id, loadGraph(h.songPath)) ?? [];
    } catch (e) {
      noStrip = (e as Error).message;
    }
    h.reload(); // the doc now comes from disk, so the mixer and the engine agree with it
    h.log([
      `+ track ${id} (${[...written, ...strip].join(", ")})`,
      ...(noStrip ? [`no strip: ${noStrip}`] : []),
    ]);
  } catch (e) {
    h.refuse([`track new: ${(e as Error).message}`]);
  }
}

// `track order <track> <where>` — states the WHOLE order, since half of one is not an order; docs/verbs.md.
async function orderTrack(arg: string, h: CommandHost): Promise<void> {
  const [trackArg, whereArg] = splitWords(arg);
  if (!trackArg || !whereArg) {
    h.refuse([
      "usage: track order <track> <position|lane>  (e.g. track order gtr 2, or track order gtr vo.main)",
    ]);
    return;
  }
  const p = h.project();
  // A lane wired on two ports compiles to two engine tracks; the ORDER is the lane's, so both move together.
  const laneOf = (id: string): string => splitPort(id).node;
  const lanes = [...new Set(p.tracks.map((t) => laneOf(t.id)))];
  const named = (a: string): string | null => {
    const hit = p.tracks.find((t) => t.id === a || t.name === a);
    return hit ? laneOf(hit.id) : lanes.includes(a) ? a : null;
  };
  const lane = named(trackArg);
  if (!lane) {
    h.refuse([
      `no track "${trackArg}"${lanes.length ? ` — try: ${lanes.join(", ")}` : ""}`,
    ]);
    return;
  }
  const pos = orderPosition(lanes, named(whereArg) ?? whereArg);
  if (pos === null) {
    h.refuse([
      `'${whereArg}' is neither a position nor a lane of this song — try a number 1..${lanes.length}`,
    ]);
    return;
  }
  try {
    const file = setLaneOrder(
      h.songPath,
      "trackOrder",
      reorderTracks(lanes, lane, pos),
    );
    h.log([
      `${lane} is now lane ${Math.min(Math.max(pos, 1), lanes.length)} of ${lanes.length} (${file})`,
    ]);
  } catch (e) {
    h.refuse([`track order: ${(e as Error).message}`]);
    return;
  }
  await h.reload();
}

// What a mute/solo can address; a group is a lane too, silenced the same way in `graph.k7x`'s `bypassed:`.
type MixTarget = Pick<TrackDoc, "id" | "name" | "mute">;

/** Silence (or un-silence) a set of lanes and push the result — a lane's mute IS its module's bypass; docs/verbs.md. */
async function setLaneBypass(
  h: CommandHost,
  want: Map<string, boolean>,
  line: string,
): Promise<void> {
  const p = h.project();
  for (const [id, bypassed] of want) setModuleBypass(h.songPath, id, bypassed);
  await h.applyProject({
    ...p,
    tracks: p.tracks.map((x) =>
      want.has(x.id) ? { ...x, mute: want.get(x.id) as boolean } : x,
    ),
    groups: p.groups.map((x) =>
      want.has(x.id) ? { ...x, mute: want.get(x.id) as boolean } : x,
    ),
  });
  h.log([line]);
}

/** Resolve a `track mute`/`track solo` argument to a lane or a group, or report why not. */
function mixTarget(a: string, h: CommandHost, verb: string): MixTarget | null {
  const id = splitWords(a)[0];
  if (!id) {
    h.refuse([`usage: ${verb} <track|group>`]);
    return null;
  }
  const p = h.project();
  const matches = (x: { id: string; name: string }) =>
    x.id === id || x.name === id;
  const target = p.tracks.find(matches) ?? p.groups.find(matches);
  if (!target) {
    h.refuse([`no track "${id}"`]);
    return null;
  }
  return target;
}

/** `track automation add|remove <track> <param>` — a VIEW onto `node automate`; the param is everything after the track. */
async function trackAutomationCommand(
  a: string,
  h: CommandHost,
  mode: "add" | "remove",
): Promise<void> {
  const verb = `track automation ${mode}`;
  const parts = splitWords(a);
  if (parts.length < 2) {
    h.refuse([
      `usage: ${verb} <track> <param>`,
      `       (e.g. ${verb} gtr Filter Freq — the param is everything after the track)`,
    ]);
    return;
  }
  const p = h.project();
  const trackArg = parts[0];
  const param = parts.slice(1).join(" ");
  const track = p.tracks.find((t) => t.id === trackArg || t.name === trackArg);
  if (!track) {
    h.refuse([
      `no track "${trackArg}"${p.tracks.length ? ` — try: ${p.tracks.map((t) => t.id).join(", ")}` : ""}`,
    ]);
    return;
  }

  // Which module on this lane's chain declares that param; the compiled plugins carry the track they landed on.
  const owning = track.plugins.filter((pl) =>
    (builtinParamsFor(pl) ?? []).some((b) => b.name === param),
  );
  if (!owning.length) {
    const known = [
      ...new Set(
        track.plugins.flatMap((pl) =>
          (builtinParamsFor(pl) ?? []).map((b) => b.name),
        ),
      ),
    ].sort();
    h.refuse([
      `no parameter '${param}' on '${track.id}'`,
      known.length
        ? `  it has: ${known.join(", ")}`
        : `  '${track.id}' runs through no module with parameters`,
    ]);
    return;
  }
  if (owning.length > 1) {
    // Two knobs of one name on one chain is a real shape and there is no defensible way to pick — docs/verbs.md.
    const names = owning.map((pl) => moduleOfPluginId(pl.id));
    h.refuse([
      `'${param}' is on ${owning.length} modules of '${track.id}' (${names.join(", ")}) — say which:`,
      `  node automate ${names[0]} ${param} <curve>`,
    ]);
    return;
  }
  const plugin = owning[0];
  const module = moduleOfPluginId(plugin.id);

  try {
    if (mode === "remove") {
      const path = setModuleAutomationBinding(h.songPath, module, param, null);
      await h.reload();
      // The curve FILE stays, and the log is the LAST statement — docs/verbs.md, docs/refusal.md.
      h.log([`${track.id}: ${param} is no longer automated (${path})`]);
    } else {
      await addTrackAutomation(h, track, module, plugin, param);
    }
  } catch (e) {
    h.refuse([`${verb}: ${(e as Error).message}`]);
  }
}

/** The `add` half: create a flat curve where the knob already sits, and bind it — docs/verbs.md. */
async function addTrackAutomation(
  h: CommandHost,
  track: ProjectDoc["tracks"][number],
  module: string,
  plugin: ProjectDoc["tracks"][number]["plugins"][number],
  param: string,
): Promise<void> {
  const p = h.project();
  const meta = (builtinParamsFor(plugin) ?? []).find((b) => b.name === param);
  // Where the knob sits NOW, normalised — a flat curve at the wrong height is an audible jump, so refuse.
  const cur = plugin.params?.[param] ?? meta?.def;
  if (!meta || cur === undefined || !(meta.max > meta.min)) {
    h.refuse([
      `can't tell where '${param}' currently sits, so a flat curve would move it`,
      `  set it once (node param ${module} ${param} <value>), or bind a curve yourself:`,
      `  curve new <name> && node automate ${module} ${param} <name>`,
    ]);
    return;
  }
  const value = (cur - meta.min) / (meta.max - meta.min);
  const id = curveIdFor(track.id, param);
  // The song's end, so the flat line has both ends to grab; a song with no material yet gets one bar.
  const last = Math.max(
    ...p.tracks.flatMap((t) => t.clips.map((c) => c.start + c.length)),
    p.timeSigNumerator,
  );
  const rel = createFlatCurveFile(
    h.songPath,
    id,
    value,
    beatsToPosition(last, p.timeSigNumerator, p.timeSigDenominator),
  );
  const path = setModuleAutomationBinding(
    h.songPath,
    module,
    param,
    curveRef(id),
  );
  await h.reload();
  h.log([
    `${track.id}: ${param} <- ${id} (${rel}), flat at ${Math.round(value * 100)}% (${path})`,
  ]);
}

/** The module half of a `chain:module` plugin id — the name a chains file and `node automate` use. */
const moduleOfPluginId = (id: string): string => id.slice(id.indexOf(":") + 1);

/** A curve id from a lane and a param. Both may hold characters a filename and a ref may not. */
const curveIdFor = (track: string, param: string): string =>
  `${track}-${param}`.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "");

export const TRACK_LANE_VERBS: Record<string, SidHandler> = {
  // A track IS its file: write it, then reload, so what plays is what is on disk — docs/verbs.md.
  "track.new": async (a, h) => newTrack(a, h),
  "track.order": async (a, h) => orderTrack(a, h),
  // --- mixer (shared: TUI + CLI/web) — persisted to the track's file ----------
  "track.mute": async (a, h) => {
    const t = mixTarget(a, h, "mute");
    if (!t) return;
    const bypassed = !t.mute;
    await setLaneBypass(
      h,
      new Map([[t.id, bypassed]]),
      `${t.id}: ${bypassed ? "muted" : "unmuted"}`,
    );
  },
  /** Solo, as PROJECT STATE — `soloed:` at project.k7x's root, resolved by the ENGINE; docs/verbs.md. */
  "track.solo": async (a, h) => {
    const t = mixTarget(a, h, "solo");
    if (!t) return;
    const p = h.project();
    const cur = (loadProjectRoot(h.songPath).soloed ?? []).map(String);
    const on = !cur.includes(t.id);
    const next = on ? [...cur, t.id] : cur.filter((x) => x !== t.id);
    const file = join(h.songPath, "project.k7x");
    if (next.length) setFileValue(file, ["soloed"], next);
    else deleteFileValue(file, ["soloed"]);
    const unmute = on && t.mute;
    if (unmute) setModuleBypass(h.songPath, t.id, false);
    const soloSet = new Set(next);
    await h.applyProject({
      ...p,
      tracks: p.tracks.map((x) => ({
        ...x,
        solo: soloSet.has(x.id) || soloSet.has(x.group),
        ...(unmute && x.id === t.id ? { mute: false } : {}),
      })),
      groups: p.groups.map((g) => ({
        ...g,
        solo: soloSet.has(g.id),
        ...(unmute && g.id === t.id ? { mute: false } : {}),
      })),
    });
    h.log([
      `${t.id}: solo ${on ? "on" : "off"}` +
        (next.length ? ` — soloed: ${next.join(", ")}` : ""),
    ]);
  },
  "track.automation.add": (a, h) => trackAutomationCommand(a, h, "add"),
  "track.automation.remove": (a, h) => trackAutomationCommand(a, h, "remove"),
};
