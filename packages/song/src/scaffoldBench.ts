// scaffoldBench.ts — the file map for the MODULE BENCH: a `.st0` project that exists to try the
// médiathèque's modules in, and nothing else. One track through a mixer to OUT, and everything
// else is the catalogue, which is not in the folder. Rationale: apps/pl8/docs/banc.md.

import { MIXER_PLUGIN } from "@studio/engine-protocol/build";
import { MIX_NODE } from "@studio/song-schema/moduleTypes";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { DEFAULT_COUNT_IN } from "./project";
import { writeProjectFiles } from "./scaffold";

const q = (s: string) => JSON.stringify(s);

/** The marker that makes this project the one allowed to save at `@st0` level. */
export const BENCH_MARKER = "mediatekBench";

// `BENCH_MODE_LINE` went with `project_type: live`: a bench draws no timeline by declaring none.

/** The bench's own furniture, named once: a COPY in `benchChain` would rewrite every chain saved. */
export const BENCH_EDGES = {
  track: "banc",
  // The mixer's SUM, not the interface: `MIX -> OUT` past it is the master chain.
  out: MIX_NODE,
  strip: "mixer",
} as const;

/** The bench's files: a track, a strip and an output, with the catalogue mirrored in afterwards. */
export function benchFiles(name: string): Record<string, string> {
  return {
    // A project FIELD rather than a file, so `project.yaml` stays the one place saying what this is.
    "project.yaml":
      `# Le banc d'essai des modules. Généré, et régénéré à chaque ouverture depuis la\n` +
      `# médiathèque — ce que vous écrivez ICI dans un module est écrit dans le catalogue,\n` +
      `# pas dans une copie. C'est le seul projet dans ce cas. Voir apps/pl8/docs/banc.md.\n` +
      `#\n` +
      `# banc.md le dit déjà : « pas un morceau ». Rien n'y est arrangé, rien n'y est\n` +
      `# enregistré — d'où "live", qui est exactement ça : un graphe, et pas de timeline.\n` +
      `project:\n` +
      `  name: ${q(name)}\n` +
      `  tempo: 120\n` +
      `  sampleRate: 48000\n` +
      `  timeSignature: "4/4"\n` +
      `  ${BENCH_MARKER}: true\n`,

    "settings.yaml": `metronome: false\ncount_in: ${DEFAULT_COUNT_IN}\n`,

    // The stereo-output sink every run ends at.
    "modules/io/OUT/module.yaml":
      `# La sortie stéréo. Un module l'atteint en la nommant comme destination.\n` +
      `io: out\n` +
      `\n` +
      `# L'autre bord io est une ENTRÉE de l'interface — son propre dossier sous modules/io/,\n` +
      `# par exemple modules/io/guitare/module.yaml :\n` +
      `#\n` +
      `#     io: in\n` +
      `#     channel: [1]        # 1-2 canaux 1-based, ou un libellé de\n` +
      `#                         # ~/.studio/preferences.yaml (channels.in)\n` +
      `#     monitor: "on"       # off | auto (audible si armée) | on — entre guillemets,\n` +
      `#                         # sinon YAML y lit un booléen\n` +
      `#\n` +
      `# C'est ainsi qu'on fait passer une guitare DEVANT le module qu'on essaie.\n`,

    // The strip: a mixer is what a track's level became, so the bench has one from the start.
    "modules/audio/mixer/module.yaml":
      `# La tranche de console : volume, panoramique et trois bandes. Interne au moteur.\n` +
      `plugin:\n` +
      `  type: internal\n` +
      `  name: ${MIXER_PLUGIN}\n`,
    // The chain, and the one line to edit. Named in the comment because it IS the exercise.
    [GRAPH_FILE]:
      `# Le graphe, en SEGMENTS : chaque module dit où son signal va ensuite — la piste\n` +
      `# "banc" comprise, puisqu'une piste est un module comme un autre.\n` +
      `#\n` +
      `# C'EST ICI QUE L'ON ESSAIE UN MODULE. Tout le catalogue est dans modules/ : il suffit\n` +
      `# de nommer un module dans la chaîne, par son chemin SOUS son dossier de type — donc\n` +
      `# "tape-delay" pour modules/audio/tape-delay/, et "amps/neural-amp-modeler" pour\n` +
      `# modules/audio/amps/neural-amp-modeler/, qui est rangé d'un cran plus loin.\n` +
      `#\n` +
      `#     modules:\n` +
      `#       banc: [ amps/neural-amp-modeler ]\n` +
      `#       amps/neural-amp-modeler: [ mixer ]\n` +
      `#       mixer: [ MIX ]\n` +
      `#\n` +
      `# Pas de nœud à créer : un nœud sert à avoir DEUX exemplaires d'un module réglés\n` +
      `# différemment, et un banc n'en a pas besoin. C'est aussi ce nom de dossier que le\n` +
      `# constructeur cherche pour retrouver le greffon chargé et vous donner ses vrais\n` +
      `# paramètres — voir apps/st0/frontend/docs/moduleBuilder.md.\n` +
      `#\n` +
      `# \`MIX\` est la somme du mixeur, \`OUT\` l'interface : le trajet entre les deux est la\n` +
      `# CHAÎNE MASTER, et \`OUT\` porte le niveau de sortie du morceau (son \`Volume\`).\n` +
      `modules:\n` +
      `  banc: [ mixer ]\n` +
      `  mixer: [ MIX ]\n` +
      `  MIX: [ OUT ]\n`,

    // One lane, with nothing on it. A bench is a place to plug something in, not a song.
    "nodes/banc.yaml":
      `# La piste du banc. Vide : ce qu'on y entend vient de ce qu'on met dans la chaîne —\n` +
      `# une entrée live (voir modules/io/OUT/module.yaml), ou un clip déposé ici.\n` +
      `extends: "@studio/track"\n`,

    // Git tracks files and not directories, and a missing folder is one the editor cannot offer.
    "curves/.gitignore":
      `# Garde curves/ dans le dépôt tant qu'il est vide.\n` +
      `# N'ignore rien volontairement — un motif ici cacherait les courbes elles-mêmes.\n`,
  };
}

/** Write the bench into `dir`. Returns the paths written. */
export function scaffoldBench(dir: string, name: string): string[] {
  const files = benchFiles(name);
  writeProjectFiles(dir, files);
  return Object.keys(files);
}
