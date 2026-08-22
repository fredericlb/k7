// scaffoldSet.ts — the file map + writer for a new SET: two decks meeting at a crossfade, an
// empty set list, and the desk that plays them. An `.st0` folder like every other, and that is
// the whole of what a set is now — a project with no arrangement that declares a `turntables`
// surface. Hand-authored like scaffold.ts and for the same reason — the `#` comments ship to
// disk and are the one worked example a reader gets.
// Full rationale: docs/setProject.md.

import { writeProjectFiles } from "./scaffold";
// The stem vocabulary — which four, what they are called on a lane, and the control that moves
// each — is `./stems`, because the DESK needs the same names and cannot import a scaffold.
import {
  STEMS,
  type Stem,
  stemControl,
  stemCut,
  stemFile,
  stemLane,
} from "./stems";
import { GRAPH_FILE } from "./yaml/graphSchema";

const q = (s: string) => JSON.stringify(s);

/** The DECKS a scaffolded set has. Two, because two is what a crossfade takes; the file
 *  format holds any number, and nothing below this line is special-cased on these names. */
export const DECKS = ["deckA", "deckB"] as const;

/** Deck A's letter from `deckA` — the node names below are built from it, so a third deck is a
 *  third entry above and nothing else. */
const letterOf = (deck: string) => deck.replace(/^deck/, "");

/** The files of a minimal set, keyed by path relative to the project folder. */
export function setProjectFiles(name: string): Record<string, string> {
  return {
    "project.yaml":
      `# A SET: two decks meeting at a crossfade, and a list of songs to play through them.\n` +
      `#\n` +
      `# There is no arrangement, and nothing here says so: a project draws what it DECLARES,\n` +
      `# and this one declares no \`surfaces/timeline.yaml\`. What makes it a set rather than a\n` +
      `# bare rig is the \`turntables\` surface in \`surfaces/\` — and the PLAYLIST that surface\n` +
      `# names, which is where the songs come from. See packages/song/docs/setProject.md.\n` +
      `project:\n` +
      `  name: ${q(name)}\n` +
      `  # The rate the decks are played at. No tempo and no time signature: a set has no bars.\n` +
      `  sampleRate: 48000\n`,

    "mix.yaml":
      `# The CUE SHEET — where THIS set's cue points are, song by song.\n` +
      `#\n` +
      `# NOT \`views/mix.yaml\`, which is a different file entirely (the desk's old bindings; a\n` +
      `# surface carries its \`mapping:\` now). This one is at the root, and it is the desk's.\n` +
      `#\n` +
      `# It does NOT say which songs the set plays: that is the playlist \`surfaces/desk.yaml\`\n` +
      `# names, a file in \`_playlists/\` at the root of the repository, written in st0 under the\n` +
      `# cog. See packages/song/docs/playlists.md.\n` +
      `#\n` +
      `# What is left here is the half a playlist has no place for. A cue belongs to the DESK\n` +
      `# that plays a song, not to a list other sets read: two bands covering the same track\n` +
      `# drop the needle in two different places, and a playlist carrying one set's marks would\n` +
      `# hand them to the other.\n` +
      `#\n` +
      `# The desk writes this file itself — you drop a cue and the line appears. It is here to\n` +
      `# be read, corrected and committed, not filled in by hand.\n` +
      `#\n` +
      `# A ref is \`@st0/\` followed by the médiathèque id, verbatim, and the ids are what\n` +
      `# pl8 shows: \`songs/<artiste>/<album>/<titre>\`. Quote them — a plain scalar may not\n` +
      `# open with \`@\` in YAML.\n` +
      `#\n` +
      `# \`markers\` is the desk's eight cue buttons, positional, in seconds into the FILE —\n` +
      `# never the transport's clock, which moves the moment somebody touches a tempo fader:\n` +
      `#\n` +
      `#  - ref: "@st0/songs/artiste/album/titre"\n` +
      `#    markers: [ 12.5, null, 48.25 ]   # boutons 1 et 3; le 2 est vide\n` +
      `cues: []\n`,

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
      `#\n` +
      `# EACH DECK IS FIVE LANES: the record, and one per separated stem. A stem lane runs\n` +
      `# through a \`cut\` module whose gain is NEGATIVE, so the five meeting at the EQ SUBTRACT\n` +
      `# rather than add — pull one up and that instrument leaves the mix. At rest every cut is\n` +
      `# 0, its lane is silent, and what you hear is the record itself, sample for sample.\n` +
      `# See packages/dsp/docs/stemcut.md.\n` +
      `#\n` +
      `# Five feeders is what makes \`eq*\` a MEETING POINT, and a meeting point breaks a run:\n` +
      `# the EQ, the filter and the crossfade become a chain of their own — a bus — and each of\n` +
      `# the five lanes reaches it as a send. Which is exactly what the subtraction needs, since\n` +
      `# it has to happen BEFORE the EQ: taking a raw stem out of an already equalised mix would\n` +
      `# leave a residue shaped like the EQ, and the cancellation would stop cancelling the\n` +
      `# moment somebody touched a knob.\n` +
      `\n` +
      `modules:\n` +
      DECKS.map((deck) => graphForDeck(deck)).join("") +
      `  ${CROSSFADE}: [ OUT ]\n` +
      `\n` +
      // Every source lane's mute lives HERE, not on the deck: a lane's mute is its module's
      // bypass, and there is one place a bypass is written.
      mutedLanes(),

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
      `# The module is NOT copied into this project, and that is the point: pl8 owns the only\n` +
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

    // Five lanes a deck, and eight more nodes: the stems the separation wrote, and the cut that
    // takes each one out of the record. Generated rather than written out, because sixteen files
    // spelled by hand is sixteen chances to swap `bass` and `drums`.
    ...stemNodeFiles(),

    "surfaces/desk.yaml":
      `# The DESK, and what each of its controls drives.\n` +
      `#\n` +
      `# A surface: a special view the project asks its editor to draw (packages/song/docs/surfaces.md).\n` +
      `# \`split\` means a PANE — a slot in the layout, over the graph, the way the arrangement sits\n` +
      `# in a song. Press its number, or fullscreen it, exactly as you would any other pane.\n` +
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
      `#\n` +
      `# \`playlist\` is what the song browser lists — the twelve songs to hand tonight rather\n` +
      `# than the two hundred and seventy-nine on the volume. A NAME under \`_playlists/\` at the\n` +
      `# root of the repository, not a path: the folder is fixed. Write the playlists themselves\n` +
      `# in st0, under the cog. See packages/song/docs/playlists.md.\n` +
      `#\n` +
      `# Left commented because a new set has no set list yet — the desk says so on its browser\n` +
      `# until this line names one, which is a sentence you can act on.\n` +
      `#\n` +
      `# \`stems: true\` lets this desk SEPARATE a record it is handed unprepared: put one on and\n` +
      `# the four knobs below start filling, with the progress over them. WHICH chain separates is\n` +
      `# not asked here — it is one answer for the whole machine, set once with\n` +
      `# \`system stems <chaîne>\` (the cog, I/O). Prepare a whole set list in advance instead with\n` +
      `# \`playlist stems <playlist>\`.\n` +
      `#\n` +
      `# Commented for the same reason as the line above, plus one of its own: a separation is\n` +
      `# minutes of arithmetic, so it happens because a set ASKED for it and never by default.\n` +
      `type: turntables\n` +
      `layout: split\n` +
      `# playlist: ete-2026\n` +
      `# stems: true\n` +
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
      `  deckB.filter: { module: ${FILTER_B}, param: Sweep }\n` +
      // One control per stem per deck, beside the EQ's three: same shape, same file, and the
      // desk draws them in the same column. 0 leaves the instrument in, 1 takes it out.
      DECKS.map((deck) =>
        STEMS.map(
          (s) =>
            `  ${stemControl(deck, s)}: { module: ${stemCut(deck, s)}, param: Cut }\n`,
        ).join(""),
      ).join(""),
  };
}

/**
 * The lane and the cut for every stem of every deck — sixteen files, all of one shape.
 *
 * EXPORTED, and parameterised by the decks, for one caller beyond this file:
 * `scripts/migrateSetStems.ts`, which gives a set written before the stems the same sixteen files
 * a new one is scaffolded with. Two spellings of these nodes would be two sets that behave
 * differently for no reason anybody could see.
 */
export function stemNodeFiles(
  decks: readonly string[] = DECKS,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const deck of decks)
    for (const stem of STEMS) {
      out[`nodes/${stemLane(deck, stem)}.yaml`] = stemLaneNode(deck, stem);
      out[`nodes/${stemCut(deck, stem)}.yaml`] = stemCutNode(deck, stem);
    }
  return out;
}

/** One stem's lane: a deck lane like the record's, whose material is one of `stems/`'s files. */
function stemLaneNode(deck: string, stem: Stem): string {
  return (
    `# Deck ${letterOf(deck)}'s ${stem} — the lane that plays one of the separated files.\n` +
    `#\n` +
    `# A lane with no arrangement, exactly like the deck beside it: the material arrives when a\n` +
    `# song is put on, and it is \`stems/${stemFile(stem)}\` in that song's own folder. A song\n` +
    `# that has never been separated leaves this lane empty, and an empty lane subtracts nothing\n` +
    `# — which is why a deck still plays a record nobody prepared.\n` +
    `#\n` +
    `# Muted in graph.yaml, like every source lane here: it is heard through the bus only, and\n` +
    `# an unmuted stem would add its INVERTED copy straight to the master.\n` +
    `extends: "@studio/track"\n`
  );
}

/** …and the node that takes it out of the record. */
function stemCutNode(deck: string, stem: Stem): string {
  return (
    `# How much of deck ${letterOf(deck)}'s ${stem} to REMOVE — the fader's other end.\n` +
    `#\n` +
    `# The module's gain is negative, so this lane is subtracted from the record it was\n` +
    `# separated out of rather than added to it. At 0 the gain is zero: the lane is silent and\n` +
    `# the record comes through untouched, which is the whole reason it is a subtraction and not\n` +
    `# a mix of four stems. See packages/dsp/docs/stemcut.md.\n` +
    `extends: ${q(`${MEDIATEK_SEPARATION}/stemcut`)}\n` +
    `params:\n` +
    `  # 0 leaves the instrument in, 1 takes it out. What the desk's ${stem} knob moves.\n` +
    `  Cut: 0\n`
  );
}

/**
 * One deck's wiring: the record into its tempo, the four stems into their cuts, and all five
 * into the EQ — which is therefore a bus, not a step.
 *
 * The tempo stays on the RECORD's lane alone, and that is deliberate. It is an `offline` module
 * realised by warping the clip, and the desk applies that same warp to all five clips of a deck
 * (`withDecks`), so a tempo node per stem lane would be four more nodes describing one fact. The
 * binding resolves by TRACK for an offline module, and the track it names is the deck's.
 */
function graphForDeck(deck: string): string {
  const l = letterOf(deck);
  const eq = `eq${l}`;
  const port = deck === DECKS[0] ? CROSSFADE : `${CROSSFADE}#b`;
  return (
    `  ${deck}: [ tempo${l} ]\n` +
    `  tempo${l}: [ ${eq} ]\n` +
    STEMS.map(
      (s) =>
        `  ${stemLane(deck, s)}: [ ${stemCut(deck, s)} ]\n` +
        `  ${stemCut(deck, s)}: [ ${eq} ]\n`,
    ).join("") +
    `  ${eq}: [ filter${l} ]\n` +
    `  filter${l}: [ ${port} ]\n`
  );
}

/**
 * Why every SOURCE lane is muted, which is the one part of this scaffold worth reading twice.
 *
 * `out` compiles as a PARALLEL path: the dry signal carries on to the master beside the module
 * it feeds, which is what makes a send a send. So a lane feeding the bus is also heard raw, and
 * unmuted you would get the record twice — once through the EQ and the crossfade, once straight
 * out — with the crossfader unable to take either away. That was already true of deck B, which
 * ends on the crossfade's second port; it is now true of all ten lanes, because all ten feed a
 * bus.
 *
 * For the stems it is worse than a duplicate: an unmuted stem lane would add its inverted copy
 * to the master, which is the subtraction happening in the wrong place — you would hear the
 * instrument disappear from a mix that was never summed with it.
 *
 * Mute says "this lane is not heard on its own", and it works because Tracktion's muting node
 * deliberately still passes clips to aux sends and sidechains: the bus keeps its five signals,
 * the master stops getting duplicates. `engine/capot/songs/crossfade-demo.st0` measured it, and
 * engine/moteur/docs/sidechain.md says why.
 */
function mutedLanes(): string {
  const lanes = DECKS.flatMap((d) => [d, ...STEMS.map((s) => stemLane(d, s))]);
  return (
    "# Heard through the bus ONLY — see scaffoldSet.ts for why this is not optional.\n" +
    `bypassed: [ ${lanes.join(", ")} ]\n`
  );
}

const MEDIATEK_UTILITY = "@st0/audio/utility";
/** The EQ lives under `filter/`, not `utility/`: a type folder is what draws its icon. */
const MEDIATEK_FILTER = "@st0/audio/filter";
/** …and the two stem modules under `separation/`, beside each other. `stemsplit` produces the
 *  four files and `stemcut` takes one back out; they are read in that order and are no use apart,
 *  which is what earns them a folder rather than a place among the utilities. */
const MEDIATEK_SEPARATION = "@st0/audio/separation";
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
    `# file IS its arrangement; on a deck the material is whichever song the browser put on\n` +
    `# ten seconds ago, so what is committed is the deck's SETTINGS and its place in\n` +
    `# the graph. ${wiring}\n` +
    // `docs:` used to close this file, restating in a field what the comment above already says.
    // The field is gone (a note is a doc module now) and the comment is the better half anyway:
    // it is where a reader of the FILE looks, and it survives the round trip through the editor.
    `extends: "@studio/track"\n`
  );
}

/** Scaffold a new set at `dir`, returning the project-relative paths written. */
export function scaffoldSet(dir: string, name: string): string[] {
  return writeProjectFiles(dir, setProjectFiles(name));
}
