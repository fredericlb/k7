// scaffoldSet.ts — the file map + writer for a new SET: two decks meeting at a crossfade, an
// empty set list, and the desk that plays them. An `.l8` folder like every other, and that is
// the whole of what a set is now — a project with no arrangement that declares a `turntables`
// surface. Hand-authored like scaffold.ts and for the same reason — the `#` comments ship to
// disk and are the one worked example a reader gets.
// Full rationale: docs/setProject.md.

import { writeProjectFiles } from "./scaffold";
import { GRAPH_FILE } from "./yaml/graphSchema";

const q = (s: string) => JSON.stringify(s);

/** The DECKS a scaffolded set has. Two, because two is what a crossfade takes; the file
 *  format holds any number, and nothing below this line is special-cased on these names. */
export const DECKS = ["deckA", "deckB"] as const;

/** The files of a minimal set, keyed by path relative to the project folder. */
export function setProjectFiles(name: string): Record<string, string> {
  return {
    "project.yaml":
      `# A SET: two decks meeting at a crossfade, and a list of songs to play through them.\n` +
      `#\n` +
      `# There is no arrangement, and nothing here says so: a project draws what it DECLARES,\n` +
      `# and this one declares no \`surfaces/timeline.yaml\`. What makes it a set rather than a\n` +
      `# bare rig is the two files it DOES have: \`songs.yaml\`, and the \`turntables\` surface in\n` +
      `# \`surfaces/\`. See packages/song/docs/setProject.md.\n` +
      `project:\n` +
      `  name: ${q(name)}\n` +
      `  # The rate the decks are played at. No tempo and no time signature: a set has no bars.\n` +
      `  sampleRate: 48000\n`,

    "songs.yaml":
      `# The set list — which of the médiathèque's songs this set draws on.\n` +
      `#\n` +
      `# A ref is \`@st0/\` followed by the médiathèque id, verbatim, and the ids are what\n` +
      `# st0 shows: \`songs/<artiste>/<album>/<titre>\`. Quote them — a plain scalar may not\n` +
      `# open with \`@\` in YAML.\n` +
      `#\n` +
      `# UNORDERED. The running order is decided at the desk, so the list is sorted for\n` +
      `# display and its line order means nothing. What it IS for: the machine that plays the\n` +
      `# set opens file paths, so everything named here is pulled into that machine's cache\n` +
      `# before you need it — which is the difference between a set list and a folder of files.\n` +
      `#\n` +
      `# The refs stay live: fix a song in the médiathèque and every set naming it is fixed.\n` +
      `#\n` +
      `# An entry is a bare ref, or a ref that CARRIES something. Today that is \`markers\` —\n` +
      `# the desk's eight cue buttons, positional, in seconds into the FILE. A song with\n` +
      `# nothing to say stays one line, which is every song until somebody drops a cue:\n` +
      `#\n` +
      `#  - "@st0/songs/artiste/album/titre"\n` +
      `#  - ref: "@st0/songs/artiste/album/autre"\n` +
      `#    markers: [ 12.5, null, 48.25 ]   # boutons 1 et 3; le 2 est vide\n` +
      `songs: []\n`,

    [GRAPH_FILE]:
      `# Each deck through its own tempo, EQ and filter, then both meeting at one crossfade —\n` +
      `# the shape a single chain cannot express, because a chain carries ONE signal.\n` +
      `#\n` +
      `# \`deckA\` FLOWS into its tempo and on into the crossfade: a bare destination is the\n` +
      `# flow. \`deckB\`'s run ends on a PORT, \`#b\`, so it lands on the crossfade's second\n` +
      `# input without claiming the module as its own next step.\n` +
      `#\n` +
      `# The names here are NODES, from nodes/ — not modules. The modules themselves\n` +
      `# live in the médiathèque and are not copied in.\n` +
      `#\n` +
      `# The EQ and the filter sit AFTER the tempo and BEFORE the crossfade, which is where a\n` +
      `# mixing desk puts them: a channel strip is shaped on its way to the fader, so cutting a\n` +
      `# deck's bass is a property of that deck and not of the blend.\n` +
      `#\n` +
      `# Filter LAST of the three. It is the effect a hand throws — the one you want on top of\n` +
      `# whatever the EQ has already done, rather than equalised afterwards.\n` +
      `#\n` +
      `# Nothing about two is fixed. A third deck is a third lane, a third tempo and a second\n` +
      `# meeting point; the desk reads whatever is here. See packages/song/docs/ports.md.\n` +
      `\n` +
      `modules:\n` +
      `  deckA: [ ${TEMPO_A} ]\n` +
      `  deckB: [ ${TEMPO_B} ]\n` +
      `  ${TEMPO_A}: [ ${EQ_A} ]\n` +
      `  ${TEMPO_B}: [ ${EQ_B} ]\n` +
      `  ${EQ_A}: [ ${FILTER_A} ]\n` +
      `  ${EQ_B}: [ ${FILTER_B} ]\n` +
      `  ${FILTER_A}: [ ${CROSSFADE} ]\n` +
      `  ${FILTER_B}: [ ${CROSSFADE}#b ]\n` +
      `  ${CROSSFADE}: [ OUT ]\n` +
      `\n` +
      // deckB's mute lives HERE now, not on the deck: a lane's mute is its module's bypass, and
      // there is one place a bypass is written.
      MUTED_LANE,

    "nodes/deckA.yaml": deckTrack(
      "A",
      "Its run FLOWS on into the crossfade, so it fills the module's first port.",
    ),
    "nodes/deckB.yaml": deckTrack(
      "B",
      "Its run ends on `#b`, the crossfade's second port.",
    ),

    [`nodes/${CROSSFADE}.yaml`]:
      `# The crossfader, as a NODE of the médiathèque's module.\n` +
      `#\n` +
      `# The module is NOT copied into this project, and that is the point: st0 owns the only\n` +
      `# editable catalogue, so a copy here would be a second crossfade nobody maintains and\n` +
      `# nobody would notice drifting. A use of a module you do not own needs no local folder\n` +
      `# for it — see packages/song/docs/nodes.md.\n` +
      `#\n` +
      `# \`kind\`, \`inputs\` and \`category\` are inherited by NOT being stated: the two audio\n` +
      `# inputs, the second one optional, come from what this extends.\n` +
      `extends: ${q(`${MEDIATEK_UTILITY}/crossfade`)}\n` +
      `params:\n` +
      `  # Centred: both decks at once, which is where a set starts.\n` +
      `  Mix: 0.5\n`,

    [`nodes/${TEMPO_A}.yaml`]: tempoNode("A"),
    [`nodes/${TEMPO_B}.yaml`]: tempoNode("B"),

    [`nodes/${EQ_A}.yaml`]: eqNode("A"),
    [`nodes/${EQ_B}.yaml`]: eqNode("B"),

    [`nodes/${FILTER_A}.yaml`]: filterNode("A"),
    [`nodes/${FILTER_B}.yaml`]: filterNode("B"),

    "surfaces/desk.yaml":
      `# The DESK, and what each of its controls drives.\n` +
      `#\n` +
      `# A surface: a screen the project asks its editor to draw (packages/song/docs/surfaces.md).\n` +
      `# \`view\` means its own screen off the header, which is the only layout a desk draws in —\n` +
      `# it is not a band under something else.\n` +
      `#\n` +
      `# \`mapping\` is keyed by the CONTROL, because this is about a desk: a control drives at\n` +
      `# most one param, and two targets on one fader is a thing you cannot see going wrong. The\n` +
      `# reverse is allowed — two controls may name the same param, and both move it.\n` +
      `#\n` +
      `# \`module\` is the name the CHAINS file uses, not a médiathèque ref: a set has two uses\n` +
      `# of the tempo module, and a ref could not tell them apart. That ambiguity is exactly why\n` +
      `# these bindings are not in the module's own \`controller.yaml\`, which belongs to the\n` +
      `# device and is shared by every use of it — a MIDI CC is a property of the device, a desk\n` +
      `# control is a property of THIS set.\n` +
      `#\n` +
      `# \`param\` is spelled as the module's ui.yaml binds it, so this file, the panel and a MIDI\n` +
      `# map line up key for key.\n` +
      `#\n` +
      `# The control ids: see packages/ui-turntables/docs/controls.md for the list.\n` +
      `type: turntables\n` +
      `layout: view\n` +
      `mapping:\n` +
      `  crossfade: { module: ${CROSSFADE}, param: Mix }\n` +
      `  deckA.tempo: { module: ${TEMPO_A}, param: Target BPM }\n` +
      `  deckB.tempo: { module: ${TEMPO_B}, param: Target BPM }\n` +
      `  deckA.eqLow: { module: ${EQ_A}, param: Low-shelf gain }\n` +
      `  deckA.eqMid: { module: ${EQ_A}, param: Mid gain 1 }\n` +
      `  deckA.eqHigh: { module: ${EQ_A}, param: High-shelf gain }\n` +
      `  deckB.eqLow: { module: ${EQ_B}, param: Low-shelf gain }\n` +
      `  deckB.eqMid: { module: ${EQ_B}, param: Mid gain 1 }\n` +
      `  deckB.eqHigh: { module: ${EQ_B}, param: High-shelf gain }\n` +
      `  deckA.filter: { module: ${FILTER_A}, param: Sweep }\n` +
      `  deckB.filter: { module: ${FILTER_B}, param: Sweep }\n`,
  };
}

/** The médiathèque folder the set's modules come from. */
/**
 * Why deck B is MUTED, which is the one line of this scaffold worth reading twice.
 *
 * `out` compiles as a PARALLEL path: the dry signal carries on to the master beside the module
 * it feeds, which is what makes a send a send. A deck that only feeds the crossfade's second
 * port gets the same treatment, so unmuted you hear deck B twice — once raw, once through the
 * crossfade — and pushing the crossfader to deck A does not take it away. Which is exactly what
 * "the crossfader does nothing" looks like from the desk.
 *
 * Mute says "this lane is not heard on its own", and it works because Tracktion's muting node
 * deliberately still passes clips to aux sends and sidechains: the crossfade keeps its second
 * signal, the master stops getting a duplicate. `engine/capot/songs/crossfade-demo.l8` measured
 * it, and engine/moteur/docs/sidechain.md says why.
 */
const MUTED_LANE =
  "# Heard through the crossfade ONLY — see scaffoldSet.ts for why this is not optional.\n" +
  "bypassed: [ deckB ]\n";

const MEDIATEK_UTILITY = "@st0/audio/utility";
/** The EQ lives under `filter/`, not `utility/`: a type folder is what draws its icon. */
const MEDIATEK_FILTER = "@st0/audio/filter";
/** The node names the chains file wires. Short on purpose — a chains file reads better
 *  with `tempoA` in it than with the whole ref, and the ref is one line away in nodes/. */
const CROSSFADE = "crossfade";
const TEMPO_A = "tempoA";
const TEMPO_B = "tempoB";
const EQ_A = "eqA";
const EQ_B = "eqB";
const FILTER_A = "filterA";
const FILTER_B = "filterB";

/** One deck's tempo: a node of the médiathèque's cold Tempo module. */
function tempoNode(letter: string): string {
  return (
    `# Deck ${letter}'s tempo — a NODE of the médiathèque's Tempo module, one per deck\n` +
    `# because each deck plays at its own BPM and a param belongs to a use, not to a module.\n` +
    `#\n` +
    `# The module is COLD: a tempo change is a time stretch, and a stretch has to know where\n` +
    `# the file ends. That is why it sits on a deck at all — a deck's source is a file on the\n` +
    `# machine's disk, which is the one input whose whole length is knowable up front. See\n` +
    `# packages/song/docs/coldModules.md.\n` +
    `#\n` +
    `# This is what the BPM fader in Mix moves. Both at 0 is a no-op: the record plays at its\n` +
    `# own tempo until the analysis has measured one and somebody has asked for another.\n` +
    `extends: ${q(`${MEDIATEK_UTILITY}/tempo`)}\n` +
    `params:\n` +
    `  # Measured by the pass that reads the file — the same analysis the waveform uses.\n` +
    `  Source BPM: 0\n` +
    `  # What the fader sets. 0 means "leave it alone".\n` +
    `  Target BPM: 0\n`
  );
}

/** One deck's EQ: a node of the médiathèque's three-band channel EQ. */
function eqNode(letter: string): string {
  return (
    `# Deck ${letter}'s EQ — a NODE of the médiathèque's EQ 3 bandes, one per deck, because\n` +
    `# cutting THIS deck's bass is the whole point and a param belongs to a use.\n` +
    `#\n` +
    `# Unlike the tempo beside it, this one is a REAL plugin: the module is a name and a set of\n` +
    `# crossover frequencies over Tracktion's 4-band EQ, so the compiler emits a plugin and the\n` +
    `# desk's knobs move it with \`set-plugin-param\`, live and per pixel. The tempo cannot do\n` +
    `# that — it is offline, and its fader re-sends the document instead.\n` +
    `#\n` +
    `# Flat. Only the three gains are stated: the crossover points come from the module, and\n` +
    `# restating them here would let one deck quietly disagree with the other about what\n` +
    `# "mid" means.\n` +
    `extends: ${q(`${MEDIATEK_FILTER}/eq3`)}\n` +
    `params:\n` +
    `  Low-shelf gain: 0\n` +
    `  Mid gain 1: 0\n` +
    `  High-shelf gain: 0\n`
  );
}

/** One deck's filter: a node of the médiathèque's one-knob sweep. */
function filterNode(letter: string): string {
  return (
    `# Deck ${letter}'s filter — a NODE of the médiathèque's Sweep Filter, one per deck.\n` +
    `#\n` +
    `# ONE param, and that is the module's whole shape: a desk control drives at most one, so\n` +
    `# "low-pass or high-pass" cannot be a second setting. Both filters live in its graph at\n` +
    `# once and the knob decides where each sits — which is how the hardware works too.\n` +
    `#\n` +
    `# 0 is the middle of the travel and is INAUDIBLE rather than bypassed: at rest the two\n` +
    `# corners sit outside the material, at 20 kHz and 20 Hz.\n` +
    `extends: ${q(`${MEDIATEK_FILTER}/sweep`)}\n` +
    `params:\n` +
    `  Sweep: 0\n`
  );
}

/** One deck: a track that is DECLARED here and whose material arrives at play time. */
function deckTrack(letter: string, wiring: string): string {
  return (
    `# Deck ${letter}. A lane with no arrangement — it authors no \`events:\` at all.\n` +
    `#\n` +
    `# That is the one thing a SET has that an arranged song does not. In a song a lane's\n` +
    `# file IS its arrangement; on a deck the material is whichever song from songs.yaml was\n` +
    `# loaded ten seconds ago, so what is committed is the deck's SETTINGS and its place in\n` +
    `# the graph. ${wiring}\n` +
    // `docs:` used to close this file, restating in a field what the comment above already says.
    // The field is gone (a note is a doc module now) and the comment is the better half anyway:
    // it is where a reader of the FILE looks, and it survives the round trip through the editor.
    `extends: "@studio/audio-track"\n`
  );
}

/** Scaffold a new set at `dir`, returning the project-relative paths written. */
export function scaffoldSet(dir: string, name: string): string[] {
  return writeProjectFiles(dir, setProjectFiles(name));
}
