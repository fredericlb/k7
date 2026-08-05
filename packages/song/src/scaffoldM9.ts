// scaffoldM9.ts — the file map + writer for a new m9 SET: two decks meeting at a crossfade,
// and an empty set list. Hand-authored like scaffold.ts and for the same reason — the `#`
// comments ship to disk and are the one worked example a reader gets.
// Full rationale: docs/m9Project.md.

import { writeProjectFiles } from "./scaffold";

const q = (s: string) => JSON.stringify(s);

/** The DECKS a scaffolded set has. Two, because two is what a crossfade takes; the file
 *  format holds any number, and nothing below this line is special-cased on these names. */
export const DECKS = ["deckA", "deckB"] as const;

/** The files of a minimal m9 set, keyed by path relative to the project folder. */
export function m9ProjectFiles(name: string): Record<string, string> {
  return {
    "project.yaml":
      `# \`type\` is a ROOT key, beside \`trackOrder\` and \`markers\` — a fact about what these\n` +
      `# files ARE, not one of the song's settings under \`project:\`.\n` +
      `#\n` +
      `# The folder's \`.m9\` suffix is what actually decides which app opens this, and it wins\n` +
      `# if the two ever disagree. This line is here so a reader — and a loader handed the\n` +
      `# folder by absolute path, with no name to read — knows too.\n` +
      `type: m9\n` +
      `project:\n` +
      `  name: ${q(name)}\n` +
      `  # The rate the decks are played at. No tempo and no time signature: a set has no bars.\n` +
      `  sampleRate: 48000\n`,

    "songs.yaml":
      `# The set list — which of the médiathèque's songs this set draws on.\n` +
      `#\n` +
      `# A ref is \`@mediatek/\` followed by the médiathèque id, verbatim, and the ids are what\n` +
      `# st0 shows: \`songs/<artiste>/<album>/<titre>\`. Quote them — a plain scalar may not\n` +
      `# open with \`@\` in YAML.\n` +
      `#\n` +
      `# UNORDERED. The running order is decided at the desk, so the list is sorted for\n` +
      `# display and its line order means nothing. What it IS for: the machine that plays the\n` +
      `# set opens file paths, so everything named here is pulled into that machine's cache\n` +
      `# before you need it — which is the difference between a set list and a folder of files.\n` +
      `#\n` +
      `# The refs stay live: fix a song in the médiathèque and every set naming it is fixed.\n` +
      `songs: []\n` +
      `#  - "@mediatek/songs/artiste/album/titre"\n`,

    "chains.yaml":
      `# Two decks meeting at one module — the shape a single chain cannot express, because a\n` +
      `# chain carries ONE signal.\n` +
      `#\n` +
      `# \`deckA\` FLOWS into the crossfade: a bare destination is the flow, so the crossfade\n` +
      `# continues deckA's run as a step. \`deckB\` names a PORT, \`#b\`, so it lands on the\n` +
      `# module's second input without claiming it as its own next step.\n` +
      `#\n` +
      `# Nothing about two is fixed. A third deck is a third track and a second meeting point;\n` +
      `# m9 reads whatever is here. See packages/song/docs/ports.md.\n` +
      `\n` +
      `tracks:\n` +
      `  deckA: [ crossfade ]\n` +
      `  deckB: [ crossfade#b ]\n` +
      `modules:\n` +
      `  crossfade: [ OUT ]\n`,

    "tracks/deckA.yaml": deckTrack(
      "A",
      "It FLOWS into the crossfade, so it fills the module's first port.",
    ),
    "tracks/deckB.yaml": deckTrack(
      "B",
      "It lands on `#b`, the crossfade's second port.",
    ),

    "modules/audio/crossfade/module.yaml":
      `# A module that declares its OWN ports, instead of taking the one audio input its type\n` +
      `# folder would have given it. That is the whole reason a crossfade was unsayable before:\n` +
      `# \`audio/\` means one in, one out, and a folder is not the right place to decide how many\n` +
      `# wires an effect takes.\n` +
      `#\n` +
      `# \`mandatory: false\` on \`b\`: one deck loaded and the other silent is the normal state of\n` +
      `# a set, not a half-built chain.\n` +
      `#\n` +
      `# \`plugin: {type: jsdsp}\` says the sound comes from the \`jsdsp.ts\` beside this file.\n` +
      `plugin: { type: jsdsp, name: Crossfade }\n` +
      `inputs:\n` +
      `  - { name: a, type: audio }\n` +
      `  - { name: b, type: audio, mandatory: false }\n` +
      `outputs:\n` +
      `  - { name: out, type: audio }\n` +
      `params:\n` +
      `  # The graph's own parameter, by its display name — that is how a param finds its\n` +
      `  # plugin (see applyPluginParams). Centred: both decks at once.\n` +
      `  Mix: 0.5\n` +
      `docs: The crossfader. Mix at 0 is deck A alone, at 1 deck B alone, at 0.5 both at half.\n`,

    "modules/audio/crossfade/jsdsp.ts": CROSSFADE_DSP,
  };
}

/** One deck: a track that is DECLARED here and whose material arrives at play time. */
function deckTrack(letter: string, wiring: string): string {
  return (
    `# Deck ${letter}. A track with no arrangement — \`clips\` is empty and stays empty in git.\n` +
    `#\n` +
    `# That is the one thing an m9 project has that an l8 song does not. In a song a track's\n` +
    `# file IS its arrangement; on a deck the material is whichever song from songs.yaml was\n` +
    `# loaded ten seconds ago, so what is committed is the deck's SETTINGS and its place in\n` +
    `# the graph. ${wiring}\n` +
    `type: single\n` +
    `contentType: audio\n` +
    `clips: []\n` +
    `docs: Deck ${letter}.\n`
  );
}

// The crossfade's DSP, verbatim from @studio/dsp's `crossfade()` graph — a module is a FOLDER
// you can copy, so it carries its own source rather than pointing at a shared library.
const CROSSFADE_DSP = `// The crossfade's DSP. The builder arrives as an ARGUMENT, so this file imports nothing at runtime — a song
// folder has no node_modules and should never need one (the \`import type\` is erased; see dspRunner.mjs).
//
// \`input(0)\` and \`input(1)\` index the ports module.yaml declares, in order: \`a\` then \`b\`. An index and not a
// name, because this graph is compiled to JSON the engine reads with no module.yaml in sight, and position is
// the one fact both documents can hold on their own.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const mix = g.param("Mix", { min: 0, max: 1, default: 0.5 });
  // Equal GAIN, not equal power — there is no sqrt among the primitives, and adding one for a single effect
  // is how a graph language ends up with a node per effect. Linear dips ~3 dB at centre for uncorrelated
  // material, which is a known shape rather than a bug.
  const a = g.amul(g.input(0), g.sub(1, mix));
  const b = g.amul(g.input(1), mix);
  g.output(g.aadd(a, b));
};
`;

/** Scaffold a new m9 set at `dir`, returning the project-relative paths written. */
export function scaffoldM9(dir: string, name: string): string[] {
  return writeProjectFiles(dir, m9ProjectFiles(name));
}
