// scaffoldSetNodes.ts — the node files a new SET is made of, one builder per kind: platters, stem
// lanes, the strip (trim, EQ, filter, level, echo), the fades, the cue sends, the tempo and the
// assemblies. What a reader gets wrong: their `#` comments ship to disk, so they are prose for the
// person who opens the set, not notes for this code. docs/setProject.md.

import { MIX_PARAM } from "@studio/song-schema/moduleTypes";
import {
  deckPlatter,
  STEM_NEUTRAL,
  STEM_PARAM,
  STEMS,
  type Stem,
  stemFile,
  stemLane,
  stemPlatter,
  TURNTABLE_REF,
  turntableBox,
  turntableMembers,
} from "@studio/song-schema/stems";
import { formatAssembly } from "@studio/song-schema/yaml/assemblyFile";
import { ASSEMBLIES_DIR } from "@studio/song-schema/yaml/assemblySchema";

export const q = (s: string) => JSON.stringify(s);

/** The DECKS a scaffolded set has — nothing is special-cased on these names, docs/setProject.md. */
export const DECKS = ["deckA", "deckB"] as const;

/** Deck A's letter from `deckA`; the node names are built from it, so a third deck is one entry above. */
export const letterOf = (deck: string) => deck.replace(/^deck/, "");

/** One `assemblies/turntable<L>.yaml` per deck, a drawing only: it changes no node, so the `ProjectDoc` is the same. */
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

/** The lane and cut for every stem of every deck — docs/setProject.md. */
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

/** One generated PLATTER per lane that plays a file — the record and each stem (docs/platter-node-plan.md). */
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

/** One platter node, whose record arrives at play time; `stem` makes its `Gain` a bound control (song-schema/docs/stems.md). */
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

/** How loud one part plays, declared on the platter that reads its file — packages/song-schema/docs/stems.md. */
const stemGain = (stem: Stem): string =>
  `params:\n` +
  `  # 0 drops the instrument, 1 is as it was cut, 2 doubles it. The desk's ${stem} knob\n` +
  `  # moves this, and it starts CENTRED on unity — left removes, right adds.\n` +
  `  ${STEM_PARAM}: ${STEM_NEUTRAL}\n`;

/** The folder is `zz_utility`: the prefix sorts it last in the library's tree, and a ref names the folder as it is. */
const MEDIATEK_UTILITY = "@k7-core/audio/zz_utility";
/** The filter lives under `filter/`, not `utility/`: a category is what draws its icon. */
const MEDIATEK_FILTER = "@k7-core/audio/filter";
/** …and the EQ and the delay sit at the root of `audio/`, each one module with its engines — the echo is the delay's. */
const MEDIATEK_AUDIO = "@k7-core/audio";
/** …and the PLATTER, which is k7's own and not a library's: a set cannot play without it (docs/metaModules.md). */
const META_AUDIO = "@meta/audio";
/** …and the TEMPO under `cold/`: it reads a deck's whole file before playback (docs/coldModules.md). */
const MEDIATEK_COLD = "@k7-core/cold";
/** The node names the chains file wires — short on purpose, since the ref is one line away in nodes/. */
/** One per deck, facing opposite ways — TWO of them are the crossfade, docs/setProject.md. */
export const FADE_A = "fadeA";
export const FADE_B = "fadeB";
/** …and one per deck again for the headphones, which is a second fade and not a second crossfade. */
export const CUE_A = "cueA";
export const CUE_B = "cueB";
export const TEMPO_A = "tempoA";
export const TEMPO_B = "tempoB";
export const EQ_A = "eqA";
export const EQ_B = "eqB";
export const FILTER_A = "filterA";
export const FILTER_B = "filterB";
/** The gain staging: the trim HEADS the strip (and so names the chain), the level ends it. */
export const TRIM_A = "trimA";
export const TRIM_B = "trimB";
export const LEVEL_A = "levelA";
export const LEVEL_B = "levelB";
/** …and the one effect past the filter, sitting AFTER the level so its tail survives a cut. */
export const ECHO_A = "echoA";
export const ECHO_B = "echoB";

/** Each module's own param name, spelled once — a rename here is otherwise four dead controls. */
export const TRIM_PARAM = "Trim";
export const GAIN_PARAM = "Gain";
/** A Fade's one param, its lane's GAIN — not "Mix", which would name a dry/wet it does not have (engine docs/mix.md). */
export const FADE_PARAM = "Level";

/** What the desk's echo knob binds: the engine's blend around the delay, not the delay's own. */
export const ECHO_BIND = MIX_PARAM;

/** One deck's tempo: a node of the médiathèque's cold Tempo module. */
/** One deck's fade — the same module twice, `Side` deciding which way its gain runs (docs/setProject.md). */
export function fadeNode(letter: string, invert: boolean): string {
  const way = invert ? "INVERTED" : "as it stands";
  return (
    `# Deck ${letter}'s fade — a NODE of the médiathèque's Fade module, one per deck.\n` +
    `#\n` +
    `# Two of these ARE the crossfade, and they are two rather than one for a reason the\n` +
    `# engine imposes: a module's second port is wired as a SIDECHAIN, and a sidechain reads a\n` +
    `# track only while that track also reaches an audible output. A deck feeding nothing but a\n` +
    `# crossfade would therefore be heard BESIDE it, raw, with no way to take it back — see\n` +
    `# engine/k7-runtime/docs/sidechain.md. One input each, and the blend happens at the mixer.\n` +
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

/** One deck's headphone send — the same Fade module, used as a tap rather than as half a crossfade. */
export function cueNode(letter: string, from = `filter${letter}`): string {
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
    `# engine/k7-runtime/scripts/cue-bus.ts. See packages/song/docs/cue.md.\n` +
    `extends: ${q(`${MEDIATEK_UTILITY}/fade`)}\n` +
    `params:\n` +
    `  # SILENT at rest: a set starts with nothing in the headphones, and the button is what opens it.\n` +
    `  ${FADE_PARAM}: 0\n`
  );
}

export function tempoNode(letter: string): string {
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

/** The trim, level and echo of every deck. */
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
    `# held at full wet (engine/k7-runtime/docs/mix.md) — and it rests at 0: an effect you drop\n` +
    `# into a chain must not be heard before somebody asks for it.\n` +
    `#\n` +
    `# \`Time\` is in MILLISECONDS and follows nothing: the desk knows each deck's BPM, but no\n` +
    `# binding carries it here yet. See packages/k7-plugins/docs/turntables/fx.md.\n` +
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
export function eqNode(letter: string): string {
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
export function filterNode(letter: string): string {
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
    `extends: ${q(MEDIATEK_FILTER)}\n` +
    `engine: sweep\n` +
    `engines:\n` +
    `  sweep:\n` +
    `    params:\n` +
    `      Sweep: 0\n`
  );
}

/** One deck: a track that is DECLARED here and whose material arrives at play time. */
export function deckTrack(letter: string, wiring: string): string {
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
