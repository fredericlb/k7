// scaffold.ts — the file map + writer for a new lanes song: a minimal, immediately
// playable node project (one MIDI track through a 4OSC synth + a live Strudel pattern),
// `video` adding a viewport + two video tracks on top. Every file is hand-authored, not
// serialised, because its `#` comments are the one worked example a reader gets.
// Full rationale: docs/scaffold.md.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_COUNT_IN } from "./project";
import { ensureSharedLibrary, ensureSharedModules } from "./sharedFolders";

const q = (s: string) => JSON.stringify(s);

// The bundled sample video: testsrc burns the frame number in, so playback sync is visible at a glance.
const SAMPLE_VIDEO = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "samples",
  "video",
  "sample.mp4",
); // packages/song/samples/video/sample.mp4

// The files of a minimal node project, keyed by path relative to the project folder.
export function projectFiles(
  name: string,
  video: boolean,
): Record<string, string> {
  const projectYaml = video // `video` turns on picture: a 1280x720 viewport at 30fps for export, drawing the two video tracks below
    ? `project:\n` +
      `  name: ${q(name)}\n` +
      `  tempo: 120\n` +
      `  sampleRate: 48000\n` +
      `  timeSignature: "4/4"\n\n` +
      `  # Picture. viewport is [width, height, fps] — the fps is used only by export\n` +
      `  # (realtime follows the engine's clock). Video files' audio is ignored; every\n` +
      `  # sound comes from the engine.\n` +
      `  video: true\n` +
      `  viewport: [1280, 720, 30]\n` +
      `  # Draw order, bottom first: the full-frame "main" lane, then "pip" over it.\n` +
      `  layers: [main, pip]\n`
    : `project:\n` +
      `  name: ${q(name)}\n` +
      `  tempo: 120\n` +
      `  sampleRate: 48000\n` +
      `  timeSignature: "4/4"\n`;

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
      `#                         # ~/.lanes/preferences.yaml (channels.in)\n` +
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

    // Two instances of "synth", one per lane: each is its own 4OSC with its own state.
    // Everything they play is inherited from module.yaml — an instance overrides, it doesn't restate.
    "modules/instruments/synth/melody.yaml":
      `# "synth:melody" — the melody track's own 4OSC. Add \`params:\` to change this one\n` +
      `# alone; everything else comes from module.yaml beside it.\n`,
    "modules/instruments/synth/pad.yaml":
      `# "synth:pad" — the pattern's Pad lane gets its own 4OSC, so tweaking one lane's\n` +
      `# sound leaves the other's alone.\n`,

    // The graph: who feeds whom. Both lanes run their own synth instance out to OUT.
    "chains.yaml":
      `# The signal graph, as SEGMENTS: each track and each module says where its signal\n` +
      `# goes next. The chains are DERIVED by following the arrows — a run breaks where\n` +
      `# the signal splits, and where two signals meet (which is what a bus is).\n` +
      `#\n` +
      `# The two lanes use two INSTANCES of "synth" (synth/melody.yaml, synth/pad.yaml).\n` +
      `# A module is named once here, so one name means one plugin: pointing both lanes\n` +
      `# at "synth" would sum them into a single instrument instead.\n` +
      `#\n` +
      `# \`bypassed: [ … ]\` lists the modules the signal passes through untouched.\n` +
      `tracks:\n` +
      `  melody: [ synth:melody ]\n` +
      `  pad: [ synth:pad ]\n` +
      `modules:\n` +
      `  synth:melody: [ OUT ]\n` +
      `  synth:pad: [ OUT ]\n`,

    // The arrangement: one 2-bar MIDI sequence. The FILENAME names the track; timecodes are QUOTED, or YAML reads them.
    "tracks/melody.yaml":
      `type: single\ncontentType: sequences\n` +
      `mute: false\nsolo: false\n` +
      `clips:\n  - { ref: melody, start: "1:1:1" }\n`,

    // A group: no material of its own, just members — nests the two lanes below so "melody" stays top-level.
    "tracks/live.yaml": `type: group\ntracks: [pad, kit]\n`,

    // Two pattern lanes declared as tracks — the track's NAME picks the lane, matched to the pattern's `.label(...)`.
    "tracks/pad.yaml":
      `type: strudel\n` +
      `strudel: algo/pattern.strudel\n` +
      `contentType: sequences\n`,

    // The pattern's "Kit" lane: contentType "audio" means every event is a sample one-shot, not a waveform.
    "tracks/kit.yaml":
      `type: strudel\n` +
      `strudel: algo/pattern.strudel\n` +
      `contentType: audio\n`,

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
      `// track's name lands there — "Pad" on the "pad" track, so it plays through that\n` +
      `// track's chain and mixer strip. A label no track declares still plays, on a\n` +
      `// live track named after it; so does an unlabelled part, bucketed by orbit.\n` +
      `//\n` +
      `// What \`s(...)\` means depends on the lane's contentType: a waveform on "pad"\n` +
      `// (its chain brings the instrument), a sample name on "kit" — the bundled kit,\n` +
      `// your project \`samples/\` folder, or $DIRT_SAMPLES.\n` +
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
    // In `base`, not the video branch: every song gets curves, picture or not.
    "curves/.gitignore":
      `# Keeps curves/ in the repository while it is still empty.
` +
      `# Intentionally ignores nothing — a pattern here would hide the curves themselves.
`,
  };

  if (!video) return base;

  // Picture over the same audio example — all video time is DECIMAL SECONDS, cut against the wall clock.
  return {
    ...base,

    "clips/sample.yaml": `source: clips/sample.mp4\n`, // kind read from the .mp4 extension (clips/ holds both audio and video)

    // The full-frame background lane: x/y/w/h place it in viewport px, source_from is the in-point in seconds.
    "video_tracks/main.yaml":
      `# A video track: like an audio one, but it links picture and places it on the\n` +
      `# viewport. Draw order lives in project.layers, not here. All times are seconds.\n` +
      `x: 0\ny: 0\nw: 1280\nh: 720\n` +
      `clips:\n  - { ref: sample, start: 0, length: 6, source_from: 0 }\n`,

    // A picture-in-picture lane over "main", playing the same clip from 2s in — proof the compositing works.
    "video_tracks/pip.yaml":
      `x: 940\ny: 520\nw: 320\nh: 180\n` +
      `clips:\n  - { ref: sample, start: 0, length: 6, source_from: 2 }\n`,
  };
}

export function scaffold(dir: string, name: string, video = false): string[] {
  const files = projectFiles(name, video);
  const write = (rel: string, content: string): void => {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  };
  for (const [rel, content] of Object.entries(files)) write(rel, content);

  const copied: string[] = []; // the bundled sample video is binary, so it's copied separately from the text-file map above
  if (video) {
    if (!existsSync(SAMPLE_VIDEO))
      throw new Error(
        `bundled sample video missing (${SAMPLE_VIDEO}) — the @studio/song package is incomplete`,
      );
    mkdirSync(join(dir, "clips"), { recursive: true });
    copyFileSync(SAMPLE_VIDEO, join(dir, "clips/sample.mp4"));
    copied.push("clips/sample.mp4");
  }

  // Point at the workspace's shared folders, if they exist (see sharedFolders.ts — a no-op otherwise).
  ensureSharedModules(dir);
  ensureSharedLibrary(dir);

  return [...Object.keys(files), ...copied];
}
