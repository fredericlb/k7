// scaffoldLive.ts — the two `live` archetypes: a rig you play THROUGH. No arrangement and NO LANE
// — an input, a fader, the way out, and in `live-video` a lens and the frame it fills. Neither
// authors a track: a run carrying a live input materialises its own, and a camera reaching no lane
// draws its own layer, which is what makes `IN -> FADER` and a bare `CAM` things you can write.
// Full rationale: docs/liveProject.md.

import { CAMERA_NODE, RENDER_NODE } from "@studio/song-schema/moduleTypes";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { DEFAULT_COUNT_IN } from "./project";
import { writeProjectFiles } from "./scaffold";
import { addVideoRun } from "./videoOutputs";

const q = (s: string) => JSON.stringify(s);

/** The input, and the fader it runs into — spelled once, since the graph names both. */
export const LIVE_INPUT = "IN";
export const LIVE_FADER = "fader";

/** The shared strip the fader is a use of — the same one every mixer node in every project names. */
export const LIVE_STRIP = "@st0/audio/utility/mixer";

/** …and the RECORDER on the master run, which is what makes a rig something you KEEP. */
export const LIVE_RECORDER = "rec";
export const LIVE_RECORDER_REF = "@st0/audio/utility/recorder";

/** The rig's own `project.yaml`; `picture` adds the frame and SAYS so — see docs/liveProject.md. */
function liveProjectYaml(name: string, picture: boolean): string {
  return (
    `# A LIVE rig: something plugged in, heard through this machine` +
    (picture ? ` — and SEEN through it.\n` : `.\n`) +
    `#\n` +
    (picture
      ? `# It declares ONE surface, the viewport, and only because a picture has nowhere else to\n` +
        `# go: an arrangement left undrawn is still on disk, a frame nothing composites is not\n` +
        `# shown at all. No timeline and no desk. See packages/song/docs/liveProject.md.\n`
      : `# It declares no \`surfaces/\` — no timeline, no viewport, no desk — and that is the whole\n` +
        `# of what makes it this shape rather than another. A project draws what it DECLARES, so\n` +
        `# this one opens on its graph and nothing else. See packages/song/docs/liveProject.md.\n`) +
    `#\n` +
    `# It holds no material either: no \`clips/\`, no \`sequences/\`. Nothing is arranged, so\n` +
    `# nothing warns about an arrangement that is not drawn.\n` +
    `project:\n` +
    `  name: ${q(name)}\n` +
    `  # Kept although nothing is arranged: the metronome counts in it, and so does a\n` +
    `  # delay whose time is written in beats.\n` +
    `  tempo: 120\n` +
    `  sampleRate: 48000\n` +
    (picture
      ? `  # The FRAME the lens draws into: [width, height, fps]. A rig has no arrangement, so\n` +
        `  # this is the only size in the file.\n` +
        `  viewport: [1280, 720, 30]\n`
      : ``)
  );
}

/** Every file a `live` project is, without writing it — so what it will NEED can be read first. */
export function liveProjectFiles(name: string): Record<string, string> {
  return {
    "project.yaml": liveProjectYaml(name, false),

    "settings.yaml":
      `# The metronome is OFF: a rig you play through is not a rig you record to a click.\n` +
      `metronome: false\n` +
      `count_in: ${DEFAULT_COUNT_IN}\n`,

    "modules/io/OUT/module.yaml":
      `# The stereo-output sink. A module reaches it by listing OUT as a destination.\n` +
      `io: out\n`,

    [`modules/io/${LIVE_INPUT}/module.yaml`]:
      `# The live input off the audio interface — what this project exists to hear.\n` +
      `#\n` +
      `# It names NO channel, and that is deliberate: which socket you are plugged into is a fact\n` +
      `# about your RIG, and no scaffold can guess it. Until you choose one the project says so —\n` +
      `# "no channel — it feeds nothing" — which is the one thing worth being told about a rig\n` +
      `# that is not making a sound yet. Pick it on the node's card, or write it here:\n` +
      `#\n` +
      `#     channel: [1]        # 1-based; a PAIR for a stereo input, e.g. [1, 2]\n` +
      `#     channel: "guitar"   # …or a label from ~/.studio/preferences.yaml (channels.in),\n` +
      `#                         # which is the spelling that survives another machine\n` +
      `#\n` +
      `# \`monitor: "on"\` is what makes it audible without arming anything, and it is QUOTED\n` +
      `# because YAML 1.1 would otherwise read the word as \`true\`.\n` +
      `io: in\n` +
      `monitor: "on"\n` +
      `# …and a trim in dB, applied at the interface ahead of everything: 0 is unity.\n` +
      `gain: 0\n`,

    [`nodes/${LIVE_FADER}.yaml`]:
      `# The rig's fader — one USE of the SHARED strip: a level in dB, a pan and three bands,\n` +
      `# which is what a track's level is everywhere in this app. It comes with the face the\n` +
      `# library module carries, so the card draws a fader and four knobs rather than nothing.\n` +
      `#\n` +
      `# A node is where a param belongs, so a second input later gets its own fader without\n` +
      `# either touching the other's level.\n` +
      `extends: ${q(LIVE_STRIP)}\n` +
      `params:\n` +
      `  # Unity, in DECIBELS: -60 is silence and +6 the top. Never 0..1, which would look like\n` +
      `  # it worked and send half a dB for half a fader.\n` +
      `  Volume: 0\n`,

    [`nodes/${LIVE_RECORDER}.yaml`]:
      `# The rig's TAPE MACHINE, on the master run: it captures the whole mix, post-fader —\n` +
      `# what you would hear, which is what a recording of a rig should be.\n` +
      `#\n` +
      `# FREE-RUNNING. Its round button starts a take and stops it; the transport is never\n` +
      `# consulted, which is the only kind of recording a project with no arrangement can do.\n` +
      `# Clear drops the last take, Save sends it to the médiathèque's recordings.\n` +
      `#\n` +
      `# It passes the sound through untouched, so taking it out changes nothing you hear.\n` +
      `# See packages/song/docs/recorderNode.md.\n` +
      `extends: ${q(LIVE_RECORDER_REF)}\n`,

    [GRAPH_FILE]:
      `# The signal graph, as SEGMENTS: each module says where its signal goes next.\n` +
      `#\n` +
      `# There is NO LANE here, and no \`nodes/\` track file: a run carrying a live input and\n` +
      `# landing on no lane materialises its own track, the way a bus does. So this is the whole\n` +
      `# rig — input, fader, out. See packages/song/docs/liveProject.md.\n` +
      `#\n` +
      `# Put a module between the two and you have an effects chain, which is what this shape is\n` +
      `# for: \`${LIVE_INPUT}: [ amp ]\`, \`amp: [ ${LIVE_FADER} ]\`.\n` +
      `modules:\n` +
      `  # The input runs into the fader…\n` +
      `  ${LIVE_INPUT}: [ ${LIVE_FADER} ]\n` +
      `  # …and the fader into the mixer's sum, where every run in every project lands. Not\n` +
      `  # straight to OUT: the engine sums a track into the master either way, so OUT would\n` +
      `  # DRAW a bypass of the master run below that does not exist.\n` +
      `  ${LIVE_FADER}: [ MIX ]\n` +
      `  # The master run, which every project has — with the RECORDER on it, so what a take\n` +
      `  # holds is the whole mix rather than one voice of it.\n` +
      `  MIX: [ ${LIVE_RECORDER} ]\n` +
      `  ${LIVE_RECORDER}: [ OUT ]\n`,
  };
}

/** Write a new `live` project. No sample to copy and no surface to declare — just the files. */
export function scaffoldLive(dir: string, name: string): string[] {
  const files = liveProjectFiles(name);
  writeProjectFiles(dir, files);
  return Object.keys(files);
}

/**
 * Put `add` straight after `anchor`, and THROW when the anchor is not there.
 *
 * Splicing one generated file into another is how `live-video` stays "the rig plus a lens" rather
 * than a second copy of it. A `.replace` that matches nothing does nothing SILENTLY — and this one
 * already missed once, the moment the recorder went on the master run and moved the line it was
 * anchored to. The camera stayed in the file map and vanished from the graph.
 */
function afterLine(text: string, anchor: string, add: string): string {
  const lines = text.split("\n");
  const at = lines.indexOf(anchor);
  if (at < 0)
    throw new Error(
      `scaffold: the live graph no longer has "${anchor.trim()}"`,
    );
  lines.splice(at + 1, 0, add);
  return lines.join("\n");
}

/** The lens, owned the way the input is: a built-in io name, so the graph can say it bare. */
export const LIVE_CAMERA = CAMERA_NODE;

/** …and the `live-video` project's, which is the rig ADDED to rather than restated. */
export function liveVideoProjectFiles(name: string): Record<string, string> {
  const base = liveProjectFiles(name);
  const graph = addVideoRun(base[GRAPH_FILE]);
  if (graph === null)
    throw new Error(
      "scaffold: the live graph has no `modules:` map for RENDER",
    );
  return {
    ...base,

    "project.yaml": liveProjectYaml(name, true),

    [`modules/io/${LIVE_CAMERA}/module.yaml`]:
      `# The webcam — what this project exists to SHOW, beside the input it exists to hear.\n` +
      `#\n` +
      `# It names NO lens, for the reason the input names no channel: which camera you are on is\n` +
      `# a fact about your rig. Empty means whichever one this machine calls default, so it draws\n` +
      `# a picture before you have chosen anything. Pick it on the node's card, or write it here:\n` +
      `#\n` +
      `#     camera: "Logitech BRIO"   # the LABEL, as the machine reads it out — never a deviceId,\n` +
      `#                               # which is salted per browser and rotates (docs/camera.md)\n` +
      `#     frame: [40, 40, 320, 180] # …and where in the viewport it draws; omit it to fill\n` +
      `io: camera\n`,

    [GRAPH_FILE]: afterLine(
      graph,
      `  ${LIVE_RECORDER}: [ OUT ]`,
      `  # …and the picture's half: the lens composites into the frame, as the fader lands on\n` +
        `  # the sum. It needs NO video lane — a camera reaching none draws a layer of its own,\n` +
        `  # the whole frame (packages/song/docs/camera.md).\n` +
        `  ${LIVE_CAMERA}: [ ${RENDER_NODE} ]`,
    ),

    // The one surface a rig declares, and only because a picture has nowhere else to go.
    "surfaces/viewport.yaml":
      `# The FRAME — where the lens is composited with WebGL. The one surface this shape has:\n` +
      `# an arrangement can be left undrawn, but a picture nothing composites is not shown at all.\n` +
      `#\n` +
      `# \`split\` is the only layout it draws in, and that is deliberate: it owns a GL context and\n` +
      `# one <video> per layer, which a screen you opened and closed would rebuild every time.\n` +
      `# Press its number key or \`ui viewport\` to give it the window instead.\n` +
      `type: viewport\n` +
      `layout: split\n`,
  };
}

/** Write a new `live-video` project: the same rig, plus a lens and the frame it draws into. */
export function scaffoldLiveVideo(dir: string, name: string): string[] {
  const files = liveVideoProjectFiles(name);
  writeProjectFiles(dir, files);
  return Object.keys(files);
}
