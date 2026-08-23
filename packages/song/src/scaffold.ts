// scaffold.ts — the file map + writer for the two TIMELINE archetypes: `arrangement`, a
// minimal immediately-playable node project (one MIDI track through a 4OSC synth + a live
// Strudel pattern), and `video`, the same thing with a lane of PICTURE over it. The third
// archetype, `mix`, is scaffoldSet.ts. Every file is hand-authored, not serialised, because
// its `#` comments are the one worked example a reader gets.
// Full rationale: docs/scaffold.md, and packages/song-video/docs/picture.md for the video half.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import { DEFAULT_COUNT_IN } from "./project";
import { addVideoRun } from "./videoOutputs";

/**
 * The archetypes THIS module writes — the two that draw a timeline.
 *
 * `mix` is excluded rather than defaulted away, so `scaffold(dir, name, "mix")` does not
 * compile: it would otherwise write a song into a folder whose whole point is that it has no
 * arrangement. scaffoldSet.ts answers for that one, and projectLifecycle.ts is where the three
 * are dispatched.
 */
export type TimelineShape = Exclude<ProjectShape, "mix">;

const q = (s: string) => JSON.stringify(s);

// The bundled sample: testsrc burns the frame number in, so a sync problem is visible at a glance.
const SAMPLE_VIDEO = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "samples",
  "video",
  "sample.mp4",
); // packages/song/samples/video/sample.mp4

/**
 * The two lines a lane of picture needs, appended to the header by the `video` archetype alone.
 *
 * An `arrangement` gets neither, and that is what separates the two archetypes rather than
 * leaving one of them a folder short: `loadVideoProject` REQUIRES a viewport, so a header
 * carrying one is a promise that something composites into it. Writing it everywhere would put
 * a frame around nothing in every project with no shot to place.
 */
const PICTURE_HEADER =
  `\n` +
  `  # PICTURE. A song carries its own, and these two lines are what a lane of it needs.\n` +
  `  #\n` +
  `  # \`viewport\` is the frame every lane draws into: [width, height, fps]. There is no\n` +
  `  # default — a frame invented by the loader would silently letterbox every shot, and you\n` +
  `  # would find out at the export. The fps is used by EXPORT only; playing back follows\n` +
  `  # the transport.\n` +
  `  viewport: [1280, 720, 30]\n` +
  `\n` +
  `  # Draw order, bottom first. It is the ORDER and the membership at once: a name with no\n` +
  `  # file is an error, and a lane no name lists is an error too — otherwise it would\n` +
  `  # compile perfectly and simply never appear.\n` +
  `  layers: [main]\n`;

/** The project header. Its picture half is the only line the two archetypes disagree about. */
function projectYaml(name: string, picture: boolean): string {
  return (
    `project:\n` +
    `  name: ${q(name)}\n` +
    `  tempo: 120\n` +
    `  sampleRate: 48000\n` +
    `  timeSignature: "4/4"\n` +
    (picture ? PICTURE_HEADER : "")
  );
}

/** The files of a minimal node project — the `arrangement` archetype, keyed by path relative to
 *  the project folder. `videoProjectFiles` is this map with a lane of picture added. */
export function projectFiles(name: string): Record<string, string> {
  const base: Record<string, string> = {
    "project.yaml": projectYaml(name, false),

    // Project settings, in their own file — count_in is bars before an armed track starts (0 = immediately).
    "settings.yaml": `metronome: false\ncount_in: ${DEFAULT_COUNT_IN}\n`,

    // The stereo-output sink, the io module every run ends at; its comment covers the live-input edge.
    "modules/io/OUT/module.yaml":
      `# The stereo-output sink. A module reaches it by listing OUT as a destination.\n` +
      `io: out\n` +
      `\n` +
      `# The other io edge is a live input off the audio interface — its own module\n` +
      `# folder under modules/io/, e.g. modules/io/guitar/module.yaml:\n` +
      `#\n` +
      `#     io: in\n` +
      `#     channel: [1]        # 1-2 1-based channels, or a label from\n` +
      `#                         # ~/.studio/preferences.yaml (channels.in)\n` +
      `#     monitor: "on"       # off | auto (audible when armed) | on — quoted,\n` +
      `#                         # because YAML would otherwise read it as true\n`,

    // Tracktion's 4OSC, a midi→audio plugin, self-contained rather than extending a base. The FOLDER names it.
    "modules/instruments/synth/module.yaml":
      `# "synth": Tracktion's built-in 4OSC. plugin.type is the FORMAT — "internal" for a\n` +
      `# built-in, its xmlTypeName in \`name\` (an external plugin uses type: vst3 etc. and\n` +
      `# name: its real name). Add params to tweak it.\n` +
      `plugin:\n` +
      `  type: internal\n` +
      `  name: 4osc\n`,

    // Two USES of "synth", one per lane: each is its own 4OSC with its own state. They live in
    // the project's FLAT nodes/ folder — the file names the node, and `extends` is the
    // only place the module it uses is written down. A node overrides, it doesn't restate.
    "nodes/synth-melody.yaml":
      `# "synth-melody" — the melody lane's own 4OSC. Add \`params:\` to change this one\n` +
      `# alone; everything else comes from the module it extends.\n` +
      `extends: "@project/instruments/synth"\n`,
    "nodes/synth-pad.yaml":
      `# "synth-pad" — the pattern's Pad lane gets its own 4OSC, so tweaking one lane's\n` +
      `# sound leaves the other's alone.\n` +
      `extends: "@project/instruments/synth"\n`,

    // The graph: who feeds whom. Both lanes run their own synth node into the mix, and the mix
    // leaves by OUT — the run between the two being where a master chain would go.
    [GRAPH_FILE]:
      `# The signal graph, as SEGMENTS: each module says where its signal goes next. The\n` +
      `# chains are DERIVED by following the arrows — a run breaks where the signal splits,\n` +
      `# and where two signals meet (which is what a bus is).\n` +
      `#\n` +
      `# The LANES are here too ("melody", "pad"): a lane is a module like any other, and a\n` +
      `# run is named after the lane that starts it. One map, one name space — which is why\n` +
      `# the synths are "synth-melody" and "synth-pad" rather than sharing their lanes' names.\n` +
      `#\n` +
      `# A module is named once here, so one name means one plugin: pointing both lanes at\n` +
      `# one synth would sum them into a single instrument instead.\n` +
      `#\n` +
      `# \`bypassed: [ … ]\` lists the modules the signal passes through untouched — and on a\n` +
      `# lane, which produces rather than passes, that IS its mute.\n` +
      `#\n` +
      `# Two built-in outputs: \`MIX\` is the mixer's sum, where every lane ends, and \`OUT\` is\n` +
      `# the interface — which carries the song's output level as its \`Volume\` (the fader\n` +
      `# under the header meter). The run between them is the MASTER CHAIN: put a module on\n` +
      `# this line and it processes the whole mix on its way out.\n` +
      `modules:\n` +
      `  melody: [ synth-melody ]\n` +
      `  pad: [ synth-pad ]\n` +
      `  synth-melody: [ MIX ]\n` +
      `  synth-pad: [ MIX ]\n` +
      `  MIX: [ OUT ]\n`,

    // The arrangement: one 2-bar MIDI sequence on a lane. A lane is a NODE of one of the three
    // built-in track modules — what it extends says where its events come from, never what they
    // ARE. The FILENAME names it; timecodes are QUOTED, or YAML reads them.
    "nodes/melody.yaml":
      `# The melody lane. \`@studio/track\` holds events written down here — each one naming a\n` +
      `# sequence or a clip, and leaving by the lane's midi or audio output accordingly.\n` +
      `extends: "@studio/track"\n` +
      `events:\n  - { ref: melody, start: "1:1:1" }\n`,

    // A group: no material of its own, just members — nests the two lanes below so "melody" stays top-level.
    "nodes/live.yaml":
      `# A group lane: no material and no signal of its own, just members.\n` +
      `extends: "@studio/group-track"\n` +
      `tracks: [pad, kit]\n`,

    // Two pattern lanes — the lane's NAME picks the part, matched to the pattern's `.label(...)`.
    "nodes/pad.yaml":
      `# A GENERATED lane: its clips are streamed from the pattern while the transport rolls,\n` +
      `# which is why it says \`strudel:\` where an authored lane says \`events:\`.\n` +
      `extends: "@studio/strudel-track"\n` +
      `strudel: algo/pattern.strudel\n`,

    // The pattern's "Kit" part: the SAME module on the same file. Which events sound as samples
    // and which as notes is decided one event at a time, by whether the sound names a sample.
    "nodes/kit.yaml":
      `# The other half of the same pattern. Nothing here says "audio": an event whose sound\n` +
      `# resolves to a sample plays as one, every other event plays as a note.\n` +
      `extends: "@studio/strudel-track"\n` +
      `strudel: algo/pattern.strudel\n`,

    // Raw MIDI material: notes live inline as compact {t,d,k,v} maps; the FILENAME names the sequence.
    "sequences/melody.yaml":
      `notes:\n` +
      `  - { t: 0, d: 1, k: 60 }\n` +
      `  - { t: 1, d: 1, k: 62 }\n` +
      `  - { t: 2, d: 1, k: 64 }\n` +
      `  - { t: 3, d: 1, k: 65 }\n` +
      `  - { t: 4, d: 1, k: 67 }\n` +
      `  - { t: 5, d: 1, k: 69 }\n` +
      `  - { t: 6, d: 1, k: 71 }\n` +
      `  - { t: 7, d: 1, k: 72 }\n`,

    // A live Strudel pattern; it plays only when a track links it, and a file no track links to is ignored.
    "algo/pattern.strudel":
      `// A live Strudel (TidalCycles-in-JS) pattern, linked by the "pad" and "kit"\n` +
      `// tracks. While the transport plays it streams onto them, locked to the beat —\n` +
      `// edit + save to hear it change live.\n` +
      `//\n` +
      `// \`.label(...)\` names the lane a part plays on. A label matching a strudel\n` +
      `// lane's name lands there — "Pad" on the "pad" lane, so it plays through that\n` +
      `// lane's chain and mixer strip. A label no lane declares still plays, on a\n` +
      `// live track named after it; so does an unlabelled part, bucketed by orbit.\n` +
      `//\n` +
      `// What \`s(...)\` means depends on WHICH lane module the lane extends: a waveform\n` +
      `// on "pad" (a sequence lane — its chain brings the instrument), a sample name on\n` +
      `// "kit" (an audio lane) — the bundled kit, your project \`samples/\` folder, or\n` +
      `// $DIRT_SAMPLES.\n` +
      `stack(\n` +
      `  note("c e g c5").s("sawtooth").slow(2).label("Pad"),\n` +
      `  sound("bd hh sn hh").label("Kit"),\n` +
      `)\n`,
    // curves/ exists from the start, and empty. Every other entity folder appears as a
    // side effect of scaffolding a file into it, but a new song has no curve to write —
    // and a folder that isn't there is one the editor can't offer and `curve new` has to
    // invent. Git tracks files, not directories, so keeping it costs a file: this one,
    // which deliberately ignores NOTHING. A pattern here would hide the curves.
    //
    // Unconditional: every song gets curves.
    "curves/.gitignore":
      `# Keeps curves/ in the repository while it is still empty.
` +
      `# Intentionally ignores nothing — a pattern here would hide the curves themselves.
`,

    // …and the ARRANGEMENT itself, which a song has to ASK for. The timeline is a surface now
    // (docs/surfaces.md), so a folder that draws one says so here — the way a set says it wants
    // a desk. Scaffolded because a new song is a song: the alternative was a first screen with
    // no lanes on it and nothing to explain why.
    "surfaces/timeline.yaml":
      `# The ARRANGEMENT — the timeline, and the transport that rolls through it.\n` +
      `#\n` +
      `# Delete this file and the song still compiles and still plays; you simply have no lanes\n` +
      `# on screen. \`split\` puts it in the layout, sharing the window with the graph beneath —\n` +
      `# the only layout a timeline draws in. See packages/song/docs/surfaces.md.\n` +
      `type: timeline\n` +
      `layout: split\n`,
  };

  return base;
}

/**
 * The song's graph with the PICTURE's two outputs added — the `video` archetype's whole change
 * to it, and the reason the map is not restated for this shape.
 *
 * `addVideoRun` is the same splice the open path makes on a project that arrives without the run
 * (videoOutputs.ts), so the archetype and the repair cannot write the line two different ways —
 * which is exactly how `MIX: [ OUT ]` ended up spelled once in four scaffolds and once in a
 * migration script. The note above it is this file's job: the splice writes a line, not a reason.
 *
 * Throws if the base graph ever loses its `modules:` map. That cannot happen from outside — the
 * text is three lines up in this same file — and a `video` project silently scaffolded without a
 * frame's way out is worse than a failed scaffold.
 */
function videoGraph(base: string): string {
  const noted = base.replace(
    /^modules\s*:/m,
    `# …and the same pair for the PICTURE, which this project has: \`RENDER\` is where the video\n` +
      `# lanes composite — every one of them arrives there, as every audio lane arrives at \`MIX\` —\n` +
      `# and \`VIDEO_OUT\` is the frame that leaves. Put a video_effects module on the run between\n` +
      `# them and it works the whole composited frame. See packages/song/docs/videoOutputs.md.\n` +
      `modules:`,
  );
  const out = addVideoRun(noted);
  if (out === null)
    throw new Error(
      "scaffold: the base graph has no `modules:` map to add RENDER to",
    );
  return out;
}

/**
 * The files of a `video` project: the arrangement above, plus the picture it composites.
 *
 * Built by ADDING to the song map rather than by restating it, so the graph, the synth and the
 * settings cannot drift between the two archetypes. Only the header is re-derived, because the
 * viewport is a line inside it rather than a file of its own.
 *
 * The split is what the two archetypes ARE. An `arrangement` is not a video project with its
 * picture deleted — it never had a frame to letterbox into, and `loadVideoProject` says so out
 * loud rather than composing nothing. See packages/song-video/docs/picture.md.
 */
export function videoProjectFiles(name: string): Record<string, string> {
  const base = projectFiles(name);
  return {
    ...base,
    "project.yaml": projectYaml(name, true),

    [GRAPH_FILE]: videoGraph(base[GRAPH_FILE]),

    // The FRAME, declared the way the timeline is. A song's picture and a song's sound are one
    // folder, so this archetype gets a lane of each: the alternative was a feature you could
    // only discover by reading about it.
    "surfaces/viewport.yaml":
      `# The FRAME — the video lanes composited with WebGL, drawn against the playhead.\n` +
      `#\n` +
      `# \`split\` is the only layout it draws in, and that is deliberate: it owns a GL context\n` +
      `# and one <video> per layer, which a screen you opened and closed would rebuild every\n` +
      `# time. Press its number key or \`ui viewport\` to give it the window instead.\n` +
      `#\n` +
      `# Delete this file and the lanes still compile and still draw on the timeline — nothing\n` +
      `# composites them. See packages/song/docs/surfaces.md.\n` +
      `type: viewport\n` +
      `layout: split\n`,

    "clips/sample.yaml":
      `# A SOURCE, not a placement: this says which file, and video_tracks/ says where it goes.\n` +
      `# One clip file can be placed any number of times, on any number of lanes.\n` +
      `source: clips/sample.mp4\n`,

    // The full-frame picture lane. x/y/w/h place it in viewport px; omit them for the full frame.
    "video_tracks/main.yaml":
      `# A lane of picture. Every time here is DECIMAL SECONDS — picture is cut against the\n` +
      `# wall clock, where the lanes above are placed in bars against the tempo. Both are drawn\n` +
      `# on the one timeline, whose ruler reads either (the clock button in its header).\n` +
      `#\n` +
      `# Re-typing \`tempo:\` therefore slides the GRID under this shot rather than moving it:\n` +
      `# the file says seconds, and seconds is what it keeps saying.\n` +
      `#\n` +
      `# \`length: 0\` runs to the end of the source; \`source_from\` trims the head. \`mute\`\n` +
      `# means HIDDEN — there is no sound on a lane.\n` +
      `kind: video\n` +
      `# name: "A-roll"     # the lane's label; the FILENAME is still its id\n` +
      `x: 0\ny: 0\nw: 1280\nh: 720\n` +
      `events:\n  - { ref: sample, start: 0, length: 6, source_from: 0 }\n`,
  };
}

// `liveProjectFiles` was here, and wrote the third archetype: a rig, the signal path with the
// arrangement taken out and no surface at all. It is gone with the archetype — an entry in a menu
// of surfaces whose whole description is "none of them" is not a choice anyone makes on purpose.
//
// The MODE it wrote is untouched: `project_type: live` is still a legal header, st0 still opens
// one, and `mix` still declares it (scaffoldSet.ts). What no longer exists is a way to ASK for
// the bare rig — you start from a mix and throw the desk away. See docs/projectMode.md.

/** Write a project's file map under `dir`, making the folders it implies. Shared with the m9
 *  scaffold, which writes a different map the same way. */
export function writeProjectFiles(
  dir: string,
  files: Record<string, string>,
): string[] {
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  return Object.keys(files);
}

/**
 * Write a new st0 project. `shape` picks the map: an arrangement, or the same plus its picture.
 *
 * `video` also gets the bundled sample video COPIED into it, because its picture lane places it.
 * Copied rather than referenced where it sits: a project that pointed into the installed package
 * would stop opening the day the package moved, and a song is a folder you commit. An
 * `arrangement` gets none — it declares no viewport, so it has nothing to place a shot in.
 *
 * The default is `arrangement`, which is what every caller written before the archetypes were
 * named already meant by `scaffold(dir, name)`.
 */
export function scaffold(
  dir: string,
  name: string,
  shape: TimelineShape = "arrangement",
): string[] {
  const picture = shape === "video";
  const files = picture ? videoProjectFiles(name) : projectFiles(name);
  writeProjectFiles(dir, files);

  if (picture) {
    if (!existsSync(SAMPLE_VIDEO))
      throw new Error(
        `bundled sample video missing (${SAMPLE_VIDEO}) — the @studio/song package is incomplete`,
      );
    mkdirSync(join(dir, "clips"), { recursive: true });
    copyFileSync(SAMPLE_VIDEO, join(dir, "clips/sample.mp4"));
  }

  // Nothing to point at the shared folders any more: a project sees the workspace's own and
  // the machine's media library because of WHERE they are (sharedFolders.ts). The three
  // `ensure*` calls that used to write those lists into project.yaml wrote down facts the
  // loader already knew, and left a project wrong whenever one of them moved.
  return picture
    ? [...Object.keys(files), "clips/sample.mp4"]
    : Object.keys(files);
}
