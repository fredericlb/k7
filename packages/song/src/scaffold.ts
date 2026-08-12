// scaffold.ts — the file map + writer for a new l8 song: a minimal, immediately
// playable node project (one MIDI track through a 4OSC synth + a live Strudel pattern),
// with a lane of PICTURE over it. Every file is hand-authored, not serialised, because its
// `#` comments are the one worked example a reader gets.
// Full rationale: docs/scaffold.md, and docs/picture.md for the video half.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_COUNT_IN } from "./project";
import { DEFAULT_PROJECT_MODE, type ProjectMode } from "./yaml/projectSchema";

const q = (s: string) => JSON.stringify(s);

// The bundled sample: testsrc burns the frame number in, so a sync problem is visible at a glance.
const SAMPLE_VIDEO = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "samples",
  "video",
  "sample.mp4",
); // packages/song/samples/video/sample.mp4

// The files of a minimal node project, keyed by path relative to the project folder.
export function projectFiles(name: string): Record<string, string> {
  const projectYaml =
    `project:\n` +
    `  name: ${q(name)}\n` +
    `  tempo: 120\n` +
    `  sampleRate: 48000\n` +
    `  timeSignature: "4/4"\n` +
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

  const base: Record<string, string> = {
    "project.yaml": projectYaml,

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

    // The graph: who feeds whom. Both lanes run their own synth node out to OUT.
    "chains.yaml":
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
      `modules:\n` +
      `  melody: [ synth-melody ]\n` +
      `  pad: [ synth-pad ]\n` +
      `  synth-melody: [ OUT ]\n` +
      `  synth-pad: [ OUT ]\n`,

    // The arrangement: one 2-bar MIDI sequence on a lane. A lane is a NODE of one of the
    // five built-in track modules — what it extends says both what signal it carries and where
    // its clips come from. The FILENAME names it; timecodes are QUOTED, or YAML reads them.
    "nodes/melody.yaml":
      `# The melody lane. \`@studio/sequence-track\` is a lane carrying NOTES whose clips are\n` +
      `# written down here; \`@studio/audio-track\` is the same for audio.\n` +
      `extends: "@studio/sequence-track"\n` +
      `clips:\n  - { ref: melody, start: "1:1:1" }\n`,

    // A group: no material of its own, just members — nests the two lanes below so "melody" stays top-level.
    "nodes/live.yaml":
      `# A group lane: no material and no signal of its own, just members.\n` +
      `extends: "@studio/group-track"\n` +
      `tracks: [pad, kit]\n`,

    // Two pattern lanes — the lane's NAME picks the part, matched to the pattern's `.label(...)`.
    "nodes/pad.yaml":
      `# A GENERATED lane: its clips are streamed from the pattern while the transport rolls,\n` +
      `# which is why it says \`strudel:\` where an authored lane says \`clips:\`.\n` +
      `extends: "@studio/sequence-strudel-track"\n` +
      `strudel: algo/pattern.strudel\n`,

    // The pattern's "Kit" part: an AUDIO strudel lane, so every event is a sample one-shot rather than a waveform.
    "nodes/kit.yaml":
      `# The audio half of the same pattern: \`@studio/audio-strudel-track\` makes every event\n` +
      `# a sample one-shot instead of a note for an instrument to play.\n` +
      `extends: "@studio/audio-strudel-track"\n` +
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

    // …and the FRAME, declared the same way. A song's picture and a song's sound are one folder
    // now, so a new project gets a lane of each: the alternative was a feature you could only
    // discover by reading about it.
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
      `clips:\n  - { ref: sample, start: 0, length: 6, source_from: 0 }\n`,
  };

  return base;
}

/**
 * The files of a LIVE l8 project — a rig rather than a song.
 *
 * The same folder shape with the arrangement taken out: no sequence, no clip, no pattern, and no
 * placement anywhere. Those are the things that only mean something on a timeline, and this
 * project has none — l8 draws the chains graph on the whole screen (docs/projectMode.md). Leaving
 * them in would scaffold material the shell has no way to show.
 *
 * What is left is a signal path you can play THROUGH: a lane, an instrument, the output. The lane
 * extends `@studio/sequence-track`, so it carries notes and a MIDI controller plays the synth the
 * moment the engine is up — which is what makes this a rig and not an empty folder. Swap the synth
 * for a live input by following the template in `modules/io/OUT/module.yaml`.
 *
 * Built by taking the shared entries out of the song map rather than by restating them, so the
 * output sink, the settings and the synth cannot drift between the two shapes.
 */
export function liveProjectFiles(name: string): Record<string, string> {
  const song = projectFiles(name);
  return {
    "project.yaml":
      `# A LIVE project: no timeline. Nothing is placed in time, so l8 opens on the\n` +
      `# chains graph alone — no arrangement, no transport, no minimap. Setting the line\n` +
      `# below to \`arrangement\` is half of getting a song back; the other half is a\n` +
      `# \`surfaces/timeline.yaml\`, which is what draws one (packages/song/docs/surfaces.md).\n` +
      `project_type: live\n` +
      `\n` +
      `project:\n` +
      `  name: ${q(name)}\n` +
      // A tempo and a signature all the same: they are what the metronome, a MIDI capture and
      // any pattern lane count in, none of which need an arrangement to exist.
      `  tempo: 120\n` +
      `  sampleRate: 48000\n` +
      `  timeSignature: "4/4"\n`,

    "settings.yaml": song["settings.yaml"],
    "modules/io/OUT/module.yaml": song["modules/io/OUT/module.yaml"],
    "modules/instruments/synth/module.yaml":
      song["modules/instruments/synth/module.yaml"],

    "chains.yaml":
      `# The signal graph, as SEGMENTS: each module says where its signal goes next — the\n` +
      `# lane "live" included, since a lane is a module too. This IS the project: with no\n` +
      `# timeline, the graph is the whole of what l8 shows, and wiring it is the work.\n` +
      `#\n` +
      `# Right-click a node to act on it; its module's own file opens over the graph.\n` +
      `modules:\n` +
      `  live: [ synth ]\n` +
      `  synth: [ OUT ]\n`,

    // No `clips:` key at all — not an empty list. A live lane is not an arrangement with
    // nothing in it; it is a lane that is played rather than written.
    "nodes/live.yaml":
      `# Played, not arranged: a MIDI controller reaches the synth through the chain above.\n` +
      `extends: "@studio/sequence-track"\n`,

    "curves/.gitignore": song["curves/.gitignore"],
  };
}

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
 * Write a new l8 project. `mode` picks the map: a song with a timeline, or a live rig.
 *
 * A song also gets the bundled sample video COPIED into it, because its picture lane places it.
 * Copied rather than referenced where it sits: a project that pointed into the installed package
 * would stop opening the day the package moved, and a song is a folder you commit. A live rig
 * gets none — it has no arrangement, so it has nothing to place a shot on.
 */
export function scaffold(
  dir: string,
  name: string,
  mode: ProjectMode = DEFAULT_PROJECT_MODE,
): string[] {
  const files = mode === "live" ? liveProjectFiles(name) : projectFiles(name);
  writeProjectFiles(dir, files);

  if (mode !== "live") {
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
  return mode === "live"
    ? Object.keys(files)
    : [...Object.keys(files), "clips/sample.mp4"];
}
