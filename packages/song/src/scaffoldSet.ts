// scaffoldSet.ts — the file map + writer for a new SET: two decks meeting at the mixer, an
// empty set list, and the desk that plays them. An `.st0` folder like every other, and that is
// the whole of what a set is — a project with no arrangement that declares a `turntables`
// surface. Hand-authored like scaffold.ts and for the same reason — the `#` comments ship to
// disk and are the one worked example a reader gets.
// Full rationale: docs/setProject.md.

// The stem vocabulary lives in song-schema because the DESK needs the same names and cannot import a scaffold.
import {
  STEMS,
  type Stem,
  stemControl,
  stemCut,
  stemFile,
  stemLane,
} from "@studio/song-schema/stems";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { writeProjectFiles } from "./scaffold";

const q = (s: string) => JSON.stringify(s);

/** The DECKS a scaffolded set has — nothing is special-cased on these names, docs/setProject.md. */
export const DECKS = ["deckA", "deckB"] as const;

/** Deck A's letter from `deckA`; the node names are built from it, so a third deck is one entry above. */
const letterOf = (deck: string) => deck.replace(/^deck/, "");

/** The files of a minimal set, keyed by path relative to the project folder. */
export function setProjectFiles(name: string): Record<string, string> {
  return {
    "project.yaml":
      `# A SET: two decks meeting at the mixer, and a list of songs to play through them.\n` +
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
      `# Each deck through its own tempo, EQ, filter and FADE, and the two meeting at \`MIX\`.\n` +
      `#\n` +
      `# The fade is what a crossfader is here, and it is TWO modules rather than one because\n` +
      `# a module's second port is wired as a sidechain, and a sidechain reads a track only\n` +
      `# while that track also reaches an audible output. A deck feeding nothing but a\n` +
      `# crossfade would therefore be heard BESIDE it, raw, with nothing able to take it back:\n` +
      `# not a mute, not a disconnect, not a routing — all four were measured, see\n` +
      `# engine/moteur/docs/sidechain.md. One input each, and the blend at the mixer.\n` +
      `#\n` +
      `# Each fade's \`Mix\` IS its lane's gain, so its panel reads true on its own: 0 silent, 1\n` +
      `# full. The desk drives the two in MIRROR — one control, deck A inverted — which is said\n` +
      `# in \`surfaces/desk.yaml\` rather than by either module knowing about the other.\n` +
      `#\n` +
      `# The names here are NODES, from nodes/ — not modules. The modules themselves\n` +
      `# live in the médiathèque and are not copied in.\n` +
      `#\n` +
      `# The EQ and the filter sit AFTER the tempo and BEFORE the fade, which is where a\n` +
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
      `# the EQ, the filter and the fade become a chain of their own — a bus — and each of\n` +
      `# the five lanes reaches it as a send. Which is exactly what the subtraction needs, since\n` +
      `# it has to happen BEFORE the EQ: taking a raw stem out of an already equalised mix would\n` +
      `# leave a residue shaped like the EQ, and the cancellation would stop cancelling the\n` +
      `# moment somebody touched a knob.\n` +
      `#\n` +
      `# Both fades land on \`MIX\`, the mixer's sum, and \`MIX -> OUT\` is the run out to the\n` +
      `# interface — the MASTER CHAIN. A module named on that line processes the whole blend,\n` +
      `# which on a set is where a limiter belongs. \`OUT\` carries the output level itself, as\n` +
      `# its \`Volume\`.\n` +
      `\n` +
      `modules:\n` +
      DECKS.map((deck) => graphForDeck(deck)).join("") +
      `  MIX: [ OUT ]\n` +
      `\n` +
      // Every source lane's mute lives HERE, since a lane's mute is its module's bypass.
      mutedLanes(),

    "nodes/deckA.yaml": deckTrack(
      "A",
      "Its run FLOWS on into its own fade, and from there to the mixer.",
    ),
    "nodes/deckB.yaml": deckTrack(
      "B",
      "Its run FLOWS on into its own fade, opposed to deck A's, and from there to the mixer.",
    ),

    [`nodes/${FADE_A}.yaml`]: fadeNode("A", true),
    [`nodes/${FADE_B}.yaml`]: fadeNode("B", false),

    [`nodes/${TEMPO_A}.yaml`]: tempoNode("A"),
    [`nodes/${TEMPO_B}.yaml`]: tempoNode("B"),

    [`nodes/${EQ_A}.yaml`]: eqNode("A"),
    [`nodes/${EQ_B}.yaml`]: eqNode("B"),

    [`nodes/${FILTER_A}.yaml`]: filterNode("A"),
    [`nodes/${FILTER_B}.yaml`]: filterNode("B"),

    // The stems' lanes and cuts, GENERATED rather than spelled out — see docs/setProject.md.
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
      `  crossfade: { module: ${FADE_A}, param: Mix, invert: true, also: { module: ${FADE_B}, param: Mix } }\n` +
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
      // One control per stem per deck, beside the EQ's three — 0 leaves the instrument in, 1 takes it out.
      DECKS.map((deck) =>
        STEMS.map(
          (s) =>
            `  ${stemControl(deck, s)}: { module: ${stemCut(deck, s)}, param: Cut }\n`,
        ).join(""),
      ).join(""),
  };
}

/** The lane and cut for every stem of every deck; exported for migrateSetStems — docs/setProject.md. */
/** One deck's fade node, by its letter and which way its gain runs — for the scaffold and the migration. */
export function fadeNodeFile(
  letter: string,
  invert: boolean,
): Record<string, string> {
  return { [`nodes/fade${letter}.yaml`]: fadeNode(letter, invert) };
}

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

/** One deck's wiring: five lanes into the EQ, which is therefore a bus — see docs/setProject.md. */
function graphForDeck(deck: string): string {
  const l = letterOf(deck);
  const eq = `eq${l}`;
  return (
    `  ${deck}: [ tempo${l} ]\n` +
    `  tempo${l}: [ ${eq} ]\n` +
    STEMS.map(
      (s) =>
        `  ${stemLane(deck, s)}: [ ${stemCut(deck, s)} ]\n` +
        `  ${stemCut(deck, s)}: [ ${eq} ]\n`,
    ).join("") +
    `  ${eq}: [ filter${l} ]\n` +
    `  filter${l}: [ fade${l} ]\n` +
    `  fade${l}: [ MIX ]\n`
  );
}

/** Every SOURCE lane is muted because `out` is a PARALLEL path — see docs/setProject.md. */
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
/** …and the two stem modules under `separation/`: `stemsplit` writes the four files, `stemcut` removes one. */
const MEDIATEK_SEPARATION = "@st0/audio/separation";
/** The node names the chains file wires — short on purpose, since the ref is one line away in nodes/. */
/** One per deck, facing opposite ways — TWO of them are the crossfade, docs/setProject.md. */
const FADE_A = "fadeA";
const FADE_B = "fadeB";
const TEMPO_A = "tempoA";
const TEMPO_B = "tempoB";
const EQ_A = "eqA";
const EQ_B = "eqB";
const FILTER_A = "filterA";
const FILTER_B = "filterB";

/** One deck's tempo: a node of the médiathèque's cold Tempo module. */
/** One deck's fade — the same module twice, `Side` deciding which way its gain runs (docs/setProject.md). */
function fadeNode(letter: string, invert: boolean): string {
  const way = invert ? "INVERTED" : "as it stands";
  return (
    `# Deck ${letter}'s fade — a NODE of the médiathèque's Fade module, one per deck.\n` +
    `#\n` +
    `# Two of these ARE the crossfade, and they are two rather than one for a reason the\n` +
    `# engine imposes: a module's second port is wired as a SIDECHAIN, and a sidechain reads a\n` +
    `# track only while that track also reaches an audible output. A deck feeding nothing but a\n` +
    `# crossfade would therefore be heard BESIDE it, raw, with no way to take it back — see\n` +
    `# engine/moteur/docs/sidechain.md. One input each, and the blend happens at the mixer.\n` +
    `#\n` +
    `#\n` +
    `# \`Mix\` IS this lane's gain, so the panel reads true on its own: 0 silent, 1 full. The\n` +
    `# desk drives the two in MIRROR — this one takes the control ${way}, which\n` +
    `# surfaces/desk.yaml states rather than either module knowing about the other.\n` +
    `#\n` +
    `# The module is NOT copied into this project: pl8 owns the only editable catalogue, so a\n` +
    `# copy here would be a second Fade nobody maintains — packages/song/docs/nodes.md.\n` +
    `extends: ${q(`${MEDIATEK_UTILITY}/fade`)}\n` +
    `params:\n` +
    `  # Centred, like the fader that drives it: both decks at half, which is where a set starts.\n` +
    `  Mix: 0.5\n`
  );
}

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
    `extends: "@studio/track"\n`
  );
}

/** Scaffold a new set at `dir`, returning the project-relative paths written. */
export function scaffoldSet(dir: string, name: string): string[] {
  return writeProjectFiles(dir, setProjectFiles(name));
}
