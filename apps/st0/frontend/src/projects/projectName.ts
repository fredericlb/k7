// projectName.ts — le nom de dossier qu'un projet neuf portera. Pur, et à part, parce que ce
// nom n'est pas une étiquette : c'est le SUFFIXE qui décide quelle application l'ouvrira.
// Voir packages/web-protocol/projects.ts et ../../docs/projects.md.

import {
  PROJECT_SUFFIXES,
  type ProjectApp,
} from "@studio/web-protocol/projects";

export interface ProjectName {
  /** Le dossier tel qu'il sera créé, ou "" quand le nom ne convient pas. */
  folder: string;
  /** Pourquoi il ne convient pas, ou "". */
  error: string;
}

const SUFFIXES = Object.values(PROJECT_SUFFIXES);

/**
 * Le dossier à créer, pour un nom tapé et une application choisie.
 *
 * Montré AVANT de créer, comme `AddSong` montre l'arborescence déduite avant l'envoi : ici
 * aussi c'est le nom qui décide de tout, et le voir est ce qui permet de le corriger.
 *
 * Les séparateurs sont REFUSÉS et non remplacés. Le file-service les remplacerait par des `_`
 * — c'est son contrat, et il a raison de ne pas échouer — mais un écran qui a la place de le
 * dire vaut mieux qu'un dossier qui apparaît sous un autre nom que celui qu'on a lu.
 *
 * Un suffixe déjà tapé est retiré avant qu'on pose le sien : quelqu'un qui écrit « hiver.st0 »
 * puis choisit m9 dans le menu a changé d'avis, et « hiver.st0.m9 » ne serait ni l'un ni
 * l'autre. Le menu décide, toujours.
 */
export function projectFolderName(raw: string, app: ProjectApp): ProjectName {
  const name = raw.trim();
  if (!name) return { folder: "", error: "il faut un nom" };
  if (/[/\\]/.test(name))
    return {
      folder: "",
      error: "pas de « / » ni de « \\ » dans un nom de projet",
    };
  // Un nom qui commence par un point est un dossier caché : le projet existerait sans se voir,
  // ni ici ni dans l'arborescence du dépôt.
  if (name.startsWith("."))
    return { folder: "", error: "un nom ne peut pas commencer par un point" };
  const stem = SUFFIXES.reduce(
    (s, suffix) =>
      s.length > suffix.length && s.toLowerCase().endsWith(suffix)
        ? s.slice(0, -suffix.length)
        : s,
    name,
  );
  if (!stem) return { folder: "", error: "il faut un nom" };
  return { folder: `${stem}${PROJECT_SUFFIXES[app]}`, error: "" };
}
