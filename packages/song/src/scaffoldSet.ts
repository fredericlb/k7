// scaffoldSet.ts — the file map + writer for a new SET: two decks meeting at the mixer, an
// empty set list, and the desk that plays them. An `.st0` folder like every other, and that is
// the whole of what a set is — a project with no arrangement that declares a `turntables`
// surface. Hand-authored like scaffold.ts and for the same reason — the `#` comments ship to
// disk and are the one worked example a reader gets.
// Full rationale: docs/setProject.md.

// The stem vocabulary lives in song-schema because the DESK needs the same names and cannot import a scaffold.
import { MIX_PARAM } from "@studio/song-schema/moduleTypes";
import {
  deckPlatter,
  STEM_NEUTRAL,
  STEM_PARAM,
  STEMS,
  type Stem,
  stemControl,
  stemFile,
  stemLane,
  stemPlatter,
  TURNTABLE_REF,
  turntableBox,
  turntableMembers,
} from "@studio/song-schema/stems";
import { formatAssembly } from "@studio/song-schema/yaml/assemblyFile";
import { ASSEMBLIES_DIR } from "@studio/song-schema/yaml/assemblySchema";
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
      `# Each deck through its own trim, EQ, filter, LEVEL, echo and fade, and the two meeting\n` +
      `# at \`MIX\`. That order is a channel strip's, and every step of it is explained below.\n` +
      `#\n` +
      `# The fade is what a crossfader is here, and it is TWO modules rather than one because\n` +
      `# a module's second port is wired as a sidechain, and a sidechain reads a track only\n` +
      `# while that track also reaches an audible output. A deck feeding nothing but a\n` +
      `# crossfade would therefore be heard BESIDE it, raw, with nothing able to take it back:\n` +
      `# not a mute, not a disconnect, not a routing — all four were measured, see\n` +
      `# engine/st0-engine/docs/sidechain.md. One input each, and the blend at the mixer.\n` +
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
      `# The control ids: see packages/st0-plugins/docs/turntables/controls.md for the list.\n` +
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
      // Listed with the filter it is tapped off, which is also where migrateSetCue inserts it.
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

/** The lane and cut for every stem of every deck; exported for migrateSetStems — docs/setProject.md. */
/** One deck's fade node, by its letter and which way its gain runs — for the scaffold and the migration. */
export function fadeNodeFile(
  letter: string,
  invert: boolean,
): Record<string, string> {
  return { [`nodes/fade${letter}.yaml`]: fadeNode(letter, invert) };
}

/** One `assemblies/turntable<L>.yaml` per deck: the box its eighteen nodes are drawn as.
 *
 * It writes NO graph change and no node, which is the whole point — an assembly is a drawing, so a
 * set with these files and one without compile to the same `ProjectDoc`. Exported for the same
 * reason `stemNodeFiles` is: the migration gives an older set exactly the files a new one gets. */
export function assemblyFiles(
  decks: readonly string[] = DECKS,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const deck of decks) {
    const box = turntableBox(deck);
    out[`${ASSEMBLIES_DIR}/${box}.yaml`] = formatAssembly(
      { uses: TURNTABLE_REF, members: turntableMembers(deck) },
      `# ${box} — deck ${letterOf(deck)}'s nodes, drawn as one appliance.
` +
        `#
` +
        `# This file changes NOTHING about the sound: it says which of the graph's nodes are one
` +
        `# box and nothing else. Its plugs and its knobs come from the template it names, which
` +
        `# lives in the account's library — see packages/song/docs/assemblies.md.`,
    );
  }
  return out;
}

export function stemNodeFiles(
  decks: readonly string[] = DECKS,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const deck of decks)
    for (const stem of STEMS) {
      out[`nodes/${stemLane(deck, stem)}.yaml`] = stemLaneNode(deck, stem);
    }
  return out;
}

/** Every PLATTER: one per lane that plays a file — the deck's record, and one per stem.
 *
 * One reader per file, and that is the whole rule. A platter reads ONE record, so five files need
 * five of them; they are generated here for the same reason the stem lanes above are, rather than
 * being ten hand-written files that differ by a letter. See docs/platter-node-plan.md. */
export function platterNodeFiles(
  decks: readonly string[] = DECKS,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const deck of decks) {
    out[`nodes/${deckPlatter(deck)}.yaml`] = platterNode(
      letterOf(deck),
      "le disque lui-même",
    );
    for (const stem of STEMS)
      out[`nodes/${stemPlatter(deck, stem)}.yaml`] = platterNode(
        letterOf(deck),
        `la piste « ${stem} » du disque séparé`,
        stem,
      );
  }
  return out;
}

/** One platter — a NODE of the médiathèque's turntable, whose record arrives at play time.
 *
 * `stem` names the part when this platter reads one, which is what makes its `Gain` a bound
 * control rather than a level nobody touches — see packages/song-schema/docs/stems.md. */
function platterNode(letter: string, what: string, stem?: Stem): string {
  return (
    `# Le plateau de la platine ${letter} — ${what}.\n` +
    `#\n` +
    `# C'est la SOURCE de cette lane : elle ne prend pas d'entrée et fabrique son son toute seule.\n` +
    `# Avant, elle n'était déclarée nulle part — le pupitre injectait ce plugin dans le document au\n` +
    `# moment de l'envoi, donc la vue chaînes ne montrait rien avant le tempo.\n` +
    `#\n` +
    `# LE DISQUE N'EST PAS ICI, et c'est délibéré. Il est choisi en direct, il change dix fois par\n` +
    `# soirée, et l'écrire dans le projet reviendrait à commiter ce qu'on jouait ce soir-là. Le\n` +
    `# pupitre le pose sur le champ \`deckFile\` du document, en même temps que la vitesse.\n` +
    `#\n` +
    `# \`Rate: 0\` est donc l'état au repos : un plateau qu'on ouvre est à l'arrêt.\n` +
    `extends: ${q(`${META_AUDIO}/turntable`)}\n` +
    (stem ? stemGain(stem) : "")
  );
}

/** One stem's lane: a deck lane like the record's, whose material is one of `stems/`'s files. */
function stemLaneNode(deck: string, stem: Stem): string {
  return (
    `# Deck ${letterOf(deck)}'s ${stem} — the lane that plays one of the separated files.\n` +
    `#\n` +
    `# A lane with no arrangement, exactly like the deck beside it: the material arrives when a\n` +
    `# song is put on, and it is \`stems/${stemFile(stem)}\` in that song's own folder. A song\n` +
    `# that has never been separated leaves this lane empty, and the deck's own lane plays instead\n` +
    `# — which is why a deck still plays a record nobody prepared.\n` +
    `#\n` +
    `# Muted in graph.yaml, like every source lane here: it is heard through the bus only, where\n` +
    `# it is summed with the three beside it — an unmuted lane would reach the master twice.\n` +
    `extends: "@meta/track"\n`
  );
}

/** How loud one part plays — declared ON its platter, which is the node that reads its file.
 *
 * There used to be a `stemcut` module here doing `gain(Level)`, one multiply, immediately after a
 * node that already had a linear `Gain` of the same range and the same rest.
 * See packages/song-schema/docs/stems.md. */
const stemGain = (stem: Stem): string =>
  `params:\n` +
  `  # 0 drops the instrument, 1 is as it was cut, 2 doubles it. The desk's ${stem} knob\n` +
  `  # moves this, and it starts CENTRED on unity — left removes, right adds.\n` +
  `  ${STEM_PARAM}: ${STEM_NEUTRAL}\n`;

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
    // The tap listed with the split it belongs to, which is also where migrateSetCue inserts it.
    `  cue${l}: [ CUE ]\n` +
    // The echo AFTER the fader, so cutting the channel leaves its tail ringing — that is echo-out.
    `  level${l}: [ echo${l} ]\n` +
    `  echo${l}: [ fade${l} ]\n` +
    `  fade${l}: [ MIX ]\n`
  );
}

/** The note above `bus_only:`, ONE text — migrateSetCue writes the same file and must not diverge. */
export const BUS_ONLY_NOTE = [
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

const MEDIATEK_UTILITY = "@st0/audio/utility";
/** The filter lives under `filter/`, not `utility/`: a category is what draws its icon. */
const MEDIATEK_FILTER = "@st0/audio/filter";
/** …and the EQ and the delay sit at the root of `audio/`, each one module with its engines — the echo is the delay's. */
const MEDIATEK_AUDIO = "@st0/audio";
/** …and the PLATTER, which is st0's own and not a library's: a set cannot play without it (docs/metaModules.md). */
const META_AUDIO = "@meta/audio";
/** …and the TEMPO under `cold/`: it reads a deck's whole file before playback (docs/coldModules.md). */
const MEDIATEK_COLD = "@st0/cold";
/** The node names the chains file wires — short on purpose, since the ref is one line away in nodes/. */
/** One per deck, facing opposite ways — TWO of them are the crossfade, docs/setProject.md. */
const FADE_A = "fadeA";
const FADE_B = "fadeB";
/** …and one per deck again for the headphones, which is a second fade and not a second crossfade. */
const CUE_A = "cueA";
const CUE_B = "cueB";
const TEMPO_A = "tempoA";
const TEMPO_B = "tempoB";
const EQ_A = "eqA";
const EQ_B = "eqB";
const FILTER_A = "filterA";
const FILTER_B = "filterB";
/** The gain staging: the trim HEADS the strip (and so names the chain), the level ends it. */
const TRIM_A = "trimA";
const TRIM_B = "trimB";
const LEVEL_A = "levelA";
const LEVEL_B = "levelB";
/** …and the one effect past the filter, sitting AFTER the level so its tail survives a cut. */
const ECHO_A = "echoA";
const ECHO_B = "echoB";

/** Each module's own param name, spelled once — a rename here is otherwise four dead controls. */
const TRIM_PARAM = "Trim";
const GAIN_PARAM = "Gain";
/** A Fade's one param, its lane's GAIN — not "Mix", which would name a dry/wet it does not have (engine docs/mix.md). */
export const FADE_PARAM = "Level";

/** What the desk's echo knob binds: the engine's blend around the delay, not the delay's own. */
export const ECHO_BIND = MIX_PARAM;

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
    `# engine/st0-engine/docs/sidechain.md. One input each, and the blend happens at the mixer.\n` +
    `#\n` +
    `#\n` +
    `# \`Level\` IS this lane's gain, so the panel reads true on its own: 0 silent, 1 full. The\n` +
    `# desk drives the two in MIRROR — this one takes the control ${way}, which\n` +
    `# surfaces/desk.yaml states rather than either module knowing about the other.\n` +
    `#\n` +
    `# The module is NOT copied into this project: pl8 owns the only editable catalogue, so a\n` +
    `# copy here would be a second Fade nobody maintains — packages/song/docs/nodes.md.\n` +
    `extends: ${q(`${MEDIATEK_UTILITY}/fade`)}\n` +
    `params:\n` +
    `  # Centred, like the fader that drives it: both decks at half, which is where a set starts.\n` +
    `  ${FADE_PARAM}: 0.5\n`
  );
}

/** One deck's cue node, by its letter and what feeds it; for the scaffold and the migration. */
export function cueNodeFile(
  letter: string,
  from = `filter${letter}`,
): Record<string, string> {
  return { [`nodes/cue${letter}.yaml`]: cueNode(letter, from) };
}

/** One deck's headphone send — the same Fade module, used as a tap rather than as half a crossfade. */
function cueNode(letter: string, from = `filter${letter}`): string {
  return (
    `# Deck ${letter}'s CUE send — what the headphones hear of this deck.\n` +
    `#\n` +
    `# The same Fade module as the crossfade, because the question is the same one: how much of\n` +
    `# this deck goes down this path. \`Level\` is that amount, and the desk's CUE button is nothing\n` +
    `# more than this param going 0 <-> 1 — no switch anywhere in the engine.\n` +
    `#\n` +
    `# It is fed from \`${from}\`, which is to say AFTER the EQ and the filter and BEFORE the\n` +
    `# fade. That is what pre-fade listen means: moving the crossfader away from this deck must\n` +
    `# not take it out of your ears, while cutting its bass must be audible before it hits the room.\n` +
    `#\n` +
    `# Where it comes OUT is not this file's business and not the project's: \`CUE\` is a pair of\n` +
    `# the interface, named once per MACHINE in preferences.yaml. A machine with no\n` +
    `# second pair plays this bus nowhere at all — never into the room, which is measured in\n` +
    `# engine/st0-engine/scripts/cue-bus.ts. See packages/song/docs/cue.md.\n` +
    `extends: ${q(`${MEDIATEK_UTILITY}/fade`)}\n` +
    `params:\n` +
    `  # SILENT at rest: a set starts with nothing in the headphones, and the button is what opens it.\n` +
    `  ${FADE_PARAM}: 0\n`
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
    `extends: ${q(`${MEDIATEK_COLD}/tempo`)}\n` +
    `params:\n` +
    `  # Measured by the pass that reads the file — the same analysis the waveform uses.\n` +
    `  Source BPM: 0\n` +
    `  # What the fader sets. 0 means "leave it alone".\n` +
    `  Target BPM: 0\n`
  );
}

/** The trim, level and echo of every deck — exported so the migration writes the same files. */
export function stripNodeFiles(
  decks: readonly string[] = DECKS,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const deck of decks) {
    const l = letterOf(deck);
    out[`nodes/trim${l}.yaml`] = trimNode(l);
    out[`nodes/level${l}.yaml`] = levelNode(l);
    out[`nodes/echo${l}.yaml`] = echoNode(l);
  }
  return out;
}

/** One deck's input trim — the chain's HEAD, so it reaches all five of the deck's lanes. */
function trimNode(letter: string): string {
  return (
    `# Deck ${letter}'s TRIM — the input gain, and the first module of this deck's strip.\n` +
    `#\n` +
    `# First for a reason that is not taste: a deck is FIVE lanes — the record, and one per\n` +
    `# separated stem — and they all meet HERE. A trim on the deck's own lane would do nothing\n` +
    `# at all to a separated record, whose four parts play instead of the disc.\n` +
    `#\n` +
    `# Being the head, it also NAMES the chain: every plugin on this strip is filed under\n` +
    `# \`trim${letter}:\`, which is why \`bus_only\` lists this node and not the EQ.\n` +
    `#\n` +
    `# What it is for: two records cut ten years apart do not arrive at the same level, and\n` +
    `# nothing in this project normalises loudness. This is what puts them on the same footing\n` +
    `# so that 0 dB on either channel fader means the same thing.\n` +
    `extends: ${q(`${MEDIATEK_UTILITY}/trim`)}\n` +
    `params:\n` +
    `  # Unity, in the MIDDLE of the travel: the rest of a trim is "whatever the record gives".\n` +
    `  ${TRIM_PARAM}: 0\n`
  );
}

/** …and the CHANNEL FADER at the other end of it, which is not the crossfader. */
function levelNode(letter: string): string {
  return (
    `# Deck ${letter}'s LEVEL — the channel fader, in decibels.\n` +
    `#\n` +
    `# Not the crossfader, and this is the distinction the desk was missing: most of a\n` +
    `# transition is made at the channel, the crossfader being the thing you use for a hard cut.\n` +
    `# A desk whose only level control is the crossfade can blend two records and nothing else.\n` +
    `#\n` +
    `# In DECIBELS, unlike the \`fade\` it feeds: a LEVEL is read in dB, and a surface sending\n` +
    `# 0.5 for "half" would look right and be six decibels wrong. The floor is -60 and reads as\n` +
    `# silence — a fader has a bottom, and -Infinity is not a position on one.\n` +
    `#\n` +
    `# It sits AFTER the cue tap, which is what pre-fade listen means: pulling this fader down\n` +
    `# must not take the deck out of your headphones.\n` +
    `extends: ${q(`${MEDIATEK_UTILITY}/gain`)}\n` +
    `params:\n` +
    `  # 0 dB = unity. A channel fader rests OPEN; it is the crossfader that decides what is heard.\n` +
    `  ${GAIN_PARAM}: 0\n`
  );
}

/** …and the one effect past the filter, placed so that an echo-out is possible at all. */
function echoNode(letter: string): string {
  return (
    `# Deck ${letter}'s ECHO — a feedback delay, the only effect on this strip past the filter.\n` +
    `#\n` +
    `# AFTER the level, and that placement is the entire feature: an echo-out is cutting the\n` +
    `# channel and letting the repeats ring on, which works because what you cut is the delay's\n` +
    `# INPUT and not its output. Wired before the fader it would be cut along with everything else.\n` +
    `#\n` +
    `# \`mix\` is what the desk's knob moves — the ENGINE's dry/wet around the delay, whose own is\n` +
    `# held at full wet (engine/st0-engine/docs/mix.md) — and it rests at 0: an effect you drop\n` +
    `# into a chain must not be heard before somebody asks for it.\n` +
    `#\n` +
    `# \`Time\` is in MILLISECONDS and follows nothing: the desk knows each deck's BPM, but no\n` +
    `# binding carries it here yet. See packages/st0-plugins/docs/turntables/fx.md.\n` +
    `# The delay's ECHO engine: the one of them whose Time is in milliseconds.\n` +
    `extends: ${q(`${MEDIATEK_AUDIO}/delay`)}\n` +
    `engine: echo\n` +
    `engines:\n` +
    `  echo:\n` +
    `    params:\n` +
    `      # A dotted eighth at 120 BPM — the dub delay that displaces rather than doubles.\n` +
    `      Time: 375\n` +
    `      # Three or four audible repeats: enough to hear, little enough not to pile up.\n` +
    `      Feedback: 0.45\n` +
    `# DRY at rest. This is the one the desk drives.\n` +
    `mix: 0\n`
  );
}

/** One deck's EQ: a node of the médiathèque's three-band channel EQ. */
function eqNode(letter: string): string {
  return (
    `# Deck ${letter}'s EQ — a NODE of the médiathèque's EQ, one per deck, because\n` +
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
    `#\n` +
    `# The EQ module has several engines; the desk's is Tracktion's, named so a change of default\n` +
    `# moves no deck (packages/song/docs/engines.md).\n` +
    `extends: ${q(`${MEDIATEK_AUDIO}/eq`)}\n` +
    `engine: tracktion\n` +
    `engines:\n` +
    `  tracktion:\n` +
    `    params:\n` +
    `      Low-shelf gain: 0\n` +
    `      Mid gain 1: 0\n` +
    `      High-shelf gain: 0\n`
  );
}

/** One deck's filter: a node of the médiathèque's one-knob sweep. */
function filterNode(letter: string): string {
  return (
    `# Deck ${letter}'s filter — a NODE of the médiathèque's filter, on its sweep engine, one per deck.\n` +
    `#\n` +
    `# ONE param, and that is the module's whole shape: a desk control drives at most one, so\n` +
    `# "low-pass or high-pass" cannot be a second setting. Both filters live in its graph at\n` +
    `# once and the knob decides where each sits — which is how the hardware works too.\n` +
    `#\n` +
    `# 0 is the middle of the travel and is INAUDIBLE rather than bypassed: at rest the two\n` +
    `# corners sit outside the material, at 20 kHz and 20 Hz.\n` +
    `#\n` +
    `# The engine is named for the same reason the EQ's is.\n` +
    `extends: ${q(`${MEDIATEK_FILTER}/multimode`)}\n` +
    `engine: sweep\n` +
    `engines:\n` +
    `  sweep:\n` +
    `    params:\n` +
    `      Sweep: 0\n`
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
    `extends: "@meta/track"\n`
  );
}

/** Scaffold a new set at `dir`, returning the project-relative paths written. */
export function scaffoldSet(dir: string, name: string): string[] {
  return writeProjectFiles(dir, setProjectFiles(name));
}
