// scaffoldSet.ts — the file map + writer for a new SET: two decks meeting at the mixer, an
// empty set list, and the desk that plays them. An `.k7` folder like every other, and that is
// the whole of what a set is — a project with no arrangement that declares a `turntables`
// surface. Hand-authored like scaffold.ts and for the same reason — the `#` comments ship to
// disk and are the one worked example a reader gets. The node files are scaffoldSetNodes.ts.
// Full rationale: docs/setProject.md.

// The stem vocabulary lives in song-schema because the DESK needs the same names and cannot import a scaffold.
import {
  deckPlatter,
  STEM_PARAM,
  STEMS,
  stemControl,
  stemLane,
  stemPlatter,
} from "@studio/song-schema/stems";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { writeProjectFiles } from "./scaffold";
import {
  assemblyFiles,
  CUE_A,
  CUE_B,
  cueNode,
  DECKS,
  deckTrack,
  ECHO_A,
  ECHO_B,
  ECHO_BIND,
  EQ_A,
  EQ_B,
  eqNode,
  FADE_A,
  FADE_B,
  FADE_PARAM,
  FILTER_A,
  FILTER_B,
  fadeNode,
  filterNode,
  GAIN_PARAM,
  LEVEL_A,
  LEVEL_B,
  letterOf,
  platterNodeFiles,
  q,
  stemNodeFiles,
  stripNodeFiles,
  TEMPO_A,
  TEMPO_B,
  TRIM_A,
  TRIM_B,
  TRIM_PARAM,
  tempoNode,
} from "./scaffoldSetNodes";

export { DECKS } from "./scaffoldSetNodes";

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
      `# names, a file in \`_playlists/\` at the root of the repository, written in k7 under the\n` +
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
      `# A ref is \`@k7-core/\` followed by the médiathèque id, verbatim, and the ids are what\n` +
      `# pl8 shows: \`songs/<artiste>/<album>/<titre>\`. Quote them — a plain scalar may not\n` +
      `# open with \`@\` in YAML.\n` +
      `#\n` +
      `# \`markers\` is the desk's eight cue buttons, positional, in seconds into the FILE —\n` +
      `# never the transport's clock, which moves the moment somebody touches a tempo fader:\n` +
      `#\n` +
      `#  - ref: "@k7-core/songs/artiste/album/titre"\n` +
      `#    markers: [ 12.5, null, 48.25 ]   # boutons 1 et 3; le 2 est vide\n` +
      `cues: []\n`,

    [GRAPH_FILE]:
      `# Each deck through its own trim, EQ, filter, LEVEL, echo and fade, and the two meeting\n` +
      `# at \`MIX\`. That order is a channel strip's, and every step of it is explained below.\n` +
      `#\n` +
      `# The fade is what a crossfader is here, and it is TWO modules rather than one because\n` +
      `# a module's second port is wired as a sidechain, and a sidechain reads a track only\n` +
      `# while that track also reaches an audible output. A deck feeding nothing but a\n` +
      `# crossfade would therefore be heard BESIDE it, raw, with nothing able to take it back:\n` +
      `# not a mute, not a disconnect, not a routing — all four were measured, see\n` +
      `# engine/k7-runtime/docs/sidechain.md. One input each, and the blend at the mixer.\n` +
      `#\n` +
      `# Each fade's \`Level\` IS its lane's gain, so its panel reads true on its own: 0 silent, 1\n` +
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
      `# THE TRIM IS FIRST, and it is first because a deck is FIVE lanes: putting it on the\n` +
      `# deck's own lane would leave it doing nothing at all on a separated record, whose four\n` +
      `# stems play instead of the disc. Being the chain's head it trims all five together,\n` +
      `# which is what an input gain is for — two records cut ten years apart do not arrive at\n` +
      `# the same level, and nothing here normalises loudness.\n` +
      `#\n` +
      `# THE LEVEL IS THE CHANNEL FADER, and it is a different control from the crossfade below\n` +
      `# it: most of a transition is made at the channel, the crossfader being for hard cuts.\n` +
      `# In DECIBELS, unlike the fade — a level is read in dB, a crossfade position is not.\n` +
      `#\n` +
      `# THE ECHO IS AFTER THE LEVEL, which is the whole of what makes an echo-out possible:\n` +
      `# cut the channel and the delay line keeps ringing, because what you cut was its INPUT\n` +
      `# and not its output. Before the fader it would be cut with everything else.\n` +
      `#\n` +
      `# …and the headphone tap stays on \`filter\`, ahead of both — that is what pre-fade listen\n` +
      `# means. Neither the channel fader nor the crossfader may take a deck out of your ears.\n` +
      `#\n` +
      `# Nothing about two is fixed. A third deck is a third lane, a third tempo and a second\n` +
      `# meeting point; the desk reads whatever is here. See packages/song/docs/ports.md.\n` +
      `#\n` +
      `# EACH DECK IS FIVE LANES: the record, and one per separated stem. Only one side plays —\n` +
      `# a separated song leaves the record's lane empty and the four parts SUM back to it; an\n` +
      `# unseparated one is the other way round. How loud each part plays is its PLATTER's own\n` +
      `# gain: 0 drops the instrument, 1 is as it was cut, 2 doubles it.\n` +
      `# See packages/song-schema/docs/stems.md.\n` +
      `#\n` +
      `# Five feeders is what makes \`trim*\` a MEETING POINT, and a meeting point breaks a run:\n` +
      `# the trim, the EQ, the filter and the fade become a chain of their own — a bus — and\n` +
      `# each of the five lanes reaches it as a send. The parts must sum BEFORE the EQ, because\n` +
      `# a deck's strip equalises what it sends to the fader and not each instrument apart.\n` +
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

    [`nodes/${CUE_A}.yaml`]: cueNode("A"),
    [`nodes/${CUE_B}.yaml`]: cueNode("B"),

    [`nodes/${TEMPO_A}.yaml`]: tempoNode("A"),
    [`nodes/${TEMPO_B}.yaml`]: tempoNode("B"),

    [`nodes/${EQ_A}.yaml`]: eqNode("A"),
    [`nodes/${EQ_B}.yaml`]: eqNode("B"),

    [`nodes/${FILTER_A}.yaml`]: filterNode("A"),
    [`nodes/${FILTER_B}.yaml`]: filterNode("B"),

    // The three the strip gained when it stopped being three EQ knobs — docs/setProject.md.
    ...stripNodeFiles(),

    // …and the SOURCE of every lane that plays a file — docs/platter-node-plan.md.
    ...platterNodeFiles(),

    // The stems' lanes and cuts, GENERATED rather than spelled out — see docs/setProject.md.
    ...stemNodeFiles(),

    // …and the RECORD that draws each deck's eighteen nodes as one box — docs/assemblies.md.
    ...assemblyFiles(),

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
      `# The control ids: see packages/k7-plugins/docs/turntables/controls.md for the list.\n` +
      `#\n` +
      `# \`playlist\` is what the song browser lists — the twelve songs to hand tonight rather\n` +
      `# than the two hundred and seventy-nine on the volume. A NAME under \`_playlists/\` at the\n` +
      `# root of the repository, not a path: the folder is fixed. Write the playlists themselves\n` +
      `# in k7, under the cog. See packages/song/docs/playlists.md.\n` +
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
      `  crossfade: { module: ${FADE_A}, param: ${FADE_PARAM}, invert: true, also: { module: ${FADE_B}, param: ${FADE_PARAM} } }\n` +
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
      // The CUE button is a binding like any other: the send's own gain, 0 or 1. See packages/song/docs/cue.md.
      // Listed with the filter it is tapped off.
      `  deckA.cue: { module: ${CUE_A}, param: ${FADE_PARAM} }\n` +
      `  deckB.cue: { module: ${CUE_B}, param: ${FADE_PARAM} }\n` +
      // The gain staging: the input trim in front of the strip, the channel fader at the end of it.
      `  deckA.trim: { module: ${TRIM_A}, param: ${TRIM_PARAM} }\n` +
      `  deckB.trim: { module: ${TRIM_B}, param: ${TRIM_PARAM} }\n` +
      `  deckA.level: { module: ${LEVEL_A}, param: ${GAIN_PARAM} }\n` +
      `  deckB.level: { module: ${LEVEL_B}, param: ${GAIN_PARAM} }\n` +
      // …and the one effect past the filter. OPTIONAL, like the cue and the stems below it.
      `  deckA.echo: { module: ${ECHO_A}, param: "${ECHO_BIND}" }\n` +
      `  deckB.echo: { module: ${ECHO_B}, param: "${ECHO_BIND}" }\n` +
      // One control per stem per deck, beside the EQ's three — 0 leaves the instrument in, 1 takes it out.
      DECKS.map((deck) =>
        STEMS.map(
          (s) =>
            `  ${stemControl(deck, s)}: { module: ${stemPlatter(deck, s)}, param: ${STEM_PARAM} }\n`,
        ).join(""),
      ).join(""),
  };
}

/** One deck's wiring: five lanes into the TRIM, which is therefore a bus — see docs/setProject.md. */
function graphForDeck(deck: string): string {
  const l = letterOf(deck);
  // The bus HEAD, and therefore the chain's name: every plugin on this strip is filed under it.
  const head = `trim${l}`;
  return (
    // The PLATTER first: it is the source, and declaring it is what puts it on the graph at all.
    `  ${deck}: [ ${deckPlatter(deck)} ]\n` +
    `  ${deckPlatter(deck)}: [ tempo${l} ]\n` +
    `  tempo${l}: [ ${head} ]\n` +
    STEMS.map(
      (s) =>
        `  ${stemLane(deck, s)}: [ ${stemPlatter(deck, s)} ]\n` +
        // Straight into the bus: the platter's own Gain IS the part's level (song-schema docs/stems.md).
        `  ${stemPlatter(deck, s)}: [ ${head} ]\n`,
    ).join("") +
    `  ${head}: [ eq${l} ]\n` +
    `  eq${l}: [ filter${l} ]\n` +
    // TWO destinations, which is what a pre-fade headphone tap IS — see packages/song/docs/cue.md.
    `  filter${l}: [ level${l}, cue${l} ]\n` +
    // The tap listed with the split it belongs to.
    `  cue${l}: [ CUE ]\n` +
    // The echo AFTER the fader, so cutting the channel leaves its tail ringing — that is echo-out.
    `  level${l}: [ echo${l} ]\n` +
    `  echo${l}: [ fade${l} ]\n` +
    `  fade${l}: [ MIX ]\n`
  );
}

/** The note above `bus_only:`. */
const BUS_ONLY_NOTE = [
  "The strips, for the SAME reason and NOT the same word: each one now feeds two buses (the",
  "fade and the cue), so its own dry path would reach the master unfaded. `bypassed` cannot say",
  "this — it would ALSO turn the EQ off, the chain being named after its first module. See",
  "packages/song/docs/busOnly.md.",
];

/** Every SOURCE lane is muted because `out` is a PARALLEL path — see docs/setProject.md. */
function mutedLanes(): string {
  const lanes = DECKS.flatMap((d) => [d, ...STEMS.map((s) => stemLane(d, s))]);
  // The chain's HEAD names it, and the head is the trim now — `eqA` would not be a chain at all.
  const strips = DECKS.map((d) => `trim${letterOf(d)}`);
  return (
    "# Heard through the bus ONLY — see scaffoldSet.ts for why this is not optional.\n" +
    `bypassed: [ ${lanes.join(", ")} ]\n` +
    "\n" +
    BUS_ONLY_NOTE.map((l) => `# ${l}\n`).join("") +
    `bus_only: [ ${strips.join(", ")} ]\n`
  );
}

/** Scaffold a new set at `dir`, returning the project-relative paths written. */
export function scaffoldSet(dir: string, name: string): string[] {
  return writeProjectFiles(dir, setProjectFiles(name));
}
