// scaffold.ts — the file map + writer for the two TIMELINE archetypes: `arrangement`, a
// minimal immediately-playable node project (one MIDI track through a 4OSC synth + a live
// Strudel pattern), and `video`, the same thing with a lane of PICTURE over it. The third
// archetype, `mix`, is scaffoldSet.ts. The map is written as a graph and then CONVERTED to chain
// files by the migration, so a new project and a migrated one cannot differ.
// Full rationale: docs/scaffold.md, and packages/song-video/docs/picture.md for the video half.

import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import { migrateToChainFiles } from "./chainsMigrateFiles";
import { DEFAULT_COUNT_IN } from "./project";
import { SHARED_MODULES_PATH } from "./sharedFolders";
import { addVideoRun } from "./videoOutputs";
import { wsExists, wsWrite } from "./yaml/workspaceFile";

/** The archetypes THIS module writes: the two with a TIMELINE. `Extract`, so a rename breaks it and
 *  a shape with its own scaffold — `mix`, and both `live` ones — cannot be passed here by mistake. */
export type TimelineShape = Extract<ProjectShape, "arrangement" | "video">;

const q = (s: string) => JSON.stringify(s);

// The bundled sample: testsrc burns the frame number in, so a sync problem is visible at a glance.
const SAMPLE_VIDEO = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "samples",
  "video",
  "sample.mp4",
); // packages/song/samples/video/sample.mp4

/** The two header lines a lane of picture needs, written by the `video` archetype alone — docs/scaffold.md. */
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

/** The `arrangement` archetype's files, keyed by project-relative path — see docs/scaffold.md. */
export function projectFiles(name: string): Record<string, string> {
  const base: Record<string, string> = {
    "project.yaml": projectYaml(name, false),

    // Project settings, in their own file — count_in is bars before an armed track starts (0 = immediately).
    "settings.yaml": `metronome: false\ncount_in: ${DEFAULT_COUNT_IN}\n`,

    // Two USES of the workspace's "synth" module, one per lane — a node overrides, it doesn't
    // restate. The module itself is scaffolded once per WORKSPACE, by `scaffold()` below: `OUT`
    // needs no module at all (a built-in name — see docs/moduleTypes.md), and a live input off
    // the audio interface is a NODE, made with `node new io/IN guitar` (docs/scaffold.md).
    "nodes/synth-melody.yaml":
      `# "synth-melody" — the melody lane's own 4OSC. Add \`params:\` to change this one\n` +
      `# alone; everything else comes from the module it extends.\n` +
      `extends: "@workspace/instruments/synth"\n`,
    "nodes/synth-pad.yaml":
      `# "synth-pad" — the pattern's Pad lane gets its own 4OSC, so tweaking one lane's\n` +
      `# sound leaves the other's alone.\n` +
      `extends: "@workspace/instruments/synth"\n`,

    // The graph: both lanes run their own synth into MIX, which leaves by OUT (the master chain's place).
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

    // One 2-bar sequence on a lane — a NODE of a built-in track module, see docs/trackModules.md.
    "nodes/melody.yaml":
      `# The melody lane. \`@meta/track\` holds events written down here — each one naming a\n` +
      `# sequence or a clip, and leaving by the lane's midi or audio output accordingly.\n` +
      `extends: "@meta/track"\n` +
      `events:\n  - { ref: melody, start: "1:1:1" }\n`,

    // A group: no material of its own, just members — nests the two lanes below so "melody" stays top-level.
    "nodes/live.yaml":
      `# A group lane: no material and no signal of its own, just members.\n` +
      `extends: "@meta/group-track"\n` +
      `tracks: [pad, kit]\n`,

    // Two pattern lanes — the lane's NAME picks the part, matched to the pattern's `.label(...)`.
    "nodes/pad.yaml":
      `# A GENERATED lane: its clips are streamed from the pattern while the transport rolls,\n` +
      `# which is why it says \`strudel:\` where an authored lane says \`events:\`.\n` +
      `extends: "@meta/strudel-track"\n` +
      `strudel: algo/pattern.strudel\n`,

    // The pattern's "Kit" part: the SAME module on the same file, sample or note decided per event.
    "nodes/kit.yaml":
      `# The other half of the same pattern. Nothing here says "audio": an event whose sound\n` +
      `# resolves to a sample plays as one, every other event plays as a note.\n` +
      `extends: "@meta/strudel-track"\n` +
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
    // curves/ exists from the start and empty, which costs this file — see docs/scaffold.md.
    "curves/.gitignore":
      `# Keeps curves/ in the repository while it is still empty.
` +
      `# Intentionally ignores nothing — a pattern here would hide the curves themselves.
`,

    // …and the ARRANGEMENT itself, which a song has to ASK for — see docs/scaffold.md.
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

/** The song's graph with the PICTURE's two outputs SPLICED in, by the open path's own edit — docs/scaffold.md. */
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

/** The `video` project's files: the arrangement ADDED to rather than restated — see docs/scaffold.md. */
export function videoProjectFiles(name: string): Record<string, string> {
  const base = projectFiles(name);
  return {
    ...base,
    "project.yaml": projectYaml(name, true),

    [GRAPH_FILE]: videoGraph(base[GRAPH_FILE]),

    // The FRAME, declared the way the timeline is — see docs/scaffold.md.
    "surfaces/viewport.yaml":
      `# The FRAME — the video lanes composited with WebGL, drawn against the playhead.\n` +
      `#\n` +
      `# \`floating\` is the only layout it draws in: a window over whichever page is on screen,\n` +
      `# moved by its title bar and sized by its corner. \`ui viewport\` shows or hides it; hidden,\n` +
      `# it keeps its GL context and its <video> per layer, so showing it again costs nothing.\n` +
      `#\n` +
      `# Delete this file and the lanes still compile and still draw on the timeline — nothing\n` +
      `# composites them. See packages/song/docs/surfaces.md.\n` +
      `type: viewport\n` +
      `layout: floating\n`,

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
      `# name: "A-roll"     # the lane's label; the FILENAME is still its id\n` +
      `x: 0\ny: 0\nw: 1280\nh: 720\n` +
      `events:\n  - { ref: sample, start: 0, length: 6, source_from: 0 }\n`,
  };
}

/** Convert a just-written project to chain files, the main layout, and answer the files it now holds. */
export function asChainProject(dir: string): string[] {
  migrateToChainFiles(dir);
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d).sort()) {
      const abs = join(d, f);
      if (statSync(abs).isDirectory()) walk(abs);
      else out.push(relative(dir, abs).split(sep).join("/"));
    }
  };
  walk(dir);
  return out;
}

/** Write a project's file map under `dir`, making the folders it implies. */
export function writeProjectFiles(
  dir: string,
  files: Record<string, string>,
): string[] {
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    wsWrite(path, content);
  }
  return Object.keys(files);
}

// The 4OSC every scaffolded lane extends, written ONCE per WORKSPACE: a second project scaffolded
// beside the first reuses it rather than getting a second copy, since `@workspace` is shared by
// every project beside it (docs/scaffold.md). Never overwrites — a workspace's own edit to it wins.
function ensureWorkspaceSynth(dir: string): void {
  const path = resolve(
    dir,
    SHARED_MODULES_PATH,
    "instruments/synth/module.yaml",
  );
  if (wsExists(path)) return;
  mkdirSync(dirname(path), { recursive: true });
  wsWrite(
    path,
    `# "synth": Tracktion's built-in 4OSC. plugin.type is the FORMAT — "internal" for a\n` +
      `# built-in, its xmlTypeName in \`name\` (an external plugin uses type: vst3 etc. and\n` +
      `# name: its real name). Add params to tweak it.\n` +
      `plugin:\n` +
      `  type: internal\n` +
      `  name: 4osc\n`,
  );
}

/** Write a new k7 project; `video` also gets the bundled sample COPIED in — see docs/scaffold.md. */
export function scaffold(
  dir: string,
  name: string,
  shape: TimelineShape = "arrangement",
): string[] {
  const picture = shape === "video";
  const files = picture ? videoProjectFiles(name) : projectFiles(name);
  writeProjectFiles(dir, files);
  ensureWorkspaceSynth(dir);

  if (picture) {
    if (!wsExists(SAMPLE_VIDEO))
      throw new Error(
        `bundled sample video missing (${SAMPLE_VIDEO}) — the @studio/song package is incomplete`,
      );
    mkdirSync(join(dir, "clips"), { recursive: true });
    copyFileSync(SAMPLE_VIDEO, join(dir, "clips/sample.mp4"));
  }

  // Nothing points at the shared folders: a project sees them because of WHERE they are (docs/scaffold.md).
  return asChainProject(dir);
}
