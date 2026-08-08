// scaffoldBench.ts — the file map for the MODULE BENCH: a `.l8` project that exists to try the
// médiathèque's modules in, and nothing else. One track through a mixer to OUT, and everything
// else is the catalogue, which is not in the folder. Rationale: apps/st0/docs/banc.md.

import { MIXER_PLUGIN } from "@studio/engine-protocol/build";
import { DEFAULT_COUNT_IN } from "./project";
import { writeProjectFiles } from "./scaffold";

const q = (s: string) => JSON.stringify(s);

/** The marker that makes this project the one allowed to save at `@mediatek` level. */
export const BENCH_MARKER = "mediatekBench";

/**
 * The bench's files, keyed by path relative to the project folder.
 *
 * Deliberately almost empty. The catalogue is mirrored INTO `modules/` afterwards, by the file
 * service (`packages/file-service/src/bench.ts`), which is what makes every médiathèque module a
 * `@project` module here — and therefore what makes editing one edit the real thing rather than
 * a fork. What this map holds is somewhere to plug one in: a track, a strip, an output.
 *
 * Nothing is WIRED beyond that, and nothing is instantiated. A bench that arrived with the
 * catalogue already in its chains would instantiate every plugin in the médiathèque on open,
 * which is precisely the load this engine was just hardened against.
 */
export function benchFiles(name: string): Record<string, string> {
  return {
    // The marker is a project FIELD rather than a file of its own so it travels with the
    // document the compiler already reads, and so `project.yaml` remains the one place that
    // says what a project IS. The file service reads it to decide where a module save lands.
    "project.yaml":
      `# Le banc d'essai des modules. Généré, et régénéré à chaque ouverture depuis la\n` +
      `# médiathèque — ce que vous écrivez ICI dans un module est écrit dans le catalogue,\n` +
      `# pas dans une copie. C'est le seul projet dans ce cas. Voir apps/st0/docs/banc.md.\n` +
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

    // The strip. A mixer is what a track's level became, so the bench has one from the start:
    // it is the thing you set to hear a module at a sane level rather than a knob to find.
    "modules/audio/mixer/module.yaml":
      `# La tranche de console : volume, panoramique et trois bandes. Interne au moteur.\n` +
      `plugin:\n` +
      `  type: internal\n` +
      `  name: ${MIXER_PLUGIN}\n`,
    // The chain, and the one line to edit. Named in the comment because it IS the exercise.
    "chains.yaml":
      `# Le graphe, en SEGMENTS : chaque piste et chaque module dit où son signal va ensuite.\n` +
      `#\n` +
      `# C'EST ICI QUE L'ON ESSAIE UN MODULE. Tout le catalogue est dans modules/ : il suffit\n` +
      `# de nommer un module dans la chaîne, par son nom de dossier.\n` +
      `#\n` +
      `#     tracks:\n` +
      `#       banc: [ tape-delay, mixer ]\n` +
      `#     modules:\n` +
      `#       tape-delay: [ mixer ]\n` +
      `#       mixer: [ OUT ]\n` +
      `#\n` +
      `# Pas d'instance à créer : une instance sert à avoir DEUX exemplaires d'un module réglés\n` +
      `# différemment, et un banc n'en a pas besoin. C'est aussi ce nom de dossier que le\n` +
      `# constructeur cherche pour retrouver le greffon chargé et vous donner ses vrais\n` +
      `# paramètres — voir apps/l8/frontend/docs/moduleBuilder.md.\n` +
      `tracks:\n` +
      `  banc: [ mixer ]\n` +
      `modules:\n` +
      `  mixer: [ OUT ]\n`,

    // One track, with nothing on it. A bench is a place to plug something in, not a song.
    "tracks/banc.yaml":
      `# La piste du banc. Vide : ce qu'on y entend vient de ce qu'on met dans la chaîne —\n` +
      `# une entrée live (voir modules/io/OUT/module.yaml), ou un clip déposé ici.\n` +
      `type: single\n` +
      `contentType: audio\n` +
      `mute: false\n` +
      `solo: false\n` +
      `clips: []\n`,

    // Same reason as the ordinary scaffold's: git tracks files, not directories, and a folder
    // that is not there is one the editor cannot offer.
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
