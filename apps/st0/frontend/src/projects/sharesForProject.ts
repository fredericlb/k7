// sharesForProject.ts — quels partages sortent de CE projet. `origin` est écrit par la machine
// avec deux basenames, pas avec l'adresse portable d'un projet, et c'est cette asymétrie que la
// page doit franchir pour poser un bouton sur une rangée. Nommé au long plutôt que
// « projectShares » : sur Windows il se heurterait à ProjectShares.tsx, dont le résolveur de vite
// ne distingue pas la casse. Voir ../../docs/projects.md, § Les partages.

import type { ShareSummary } from "@studio/web-protocol";

/**
 * Le nom sous lequel un projet apparaît dans `origin.project`.
 *
 * Le service de fichiers écrit `origin: { repo: basename(root), project: basename(dir) }`
 * (`packages/file-service/src/workspace.ts`, `shareLink`) : le DERNIER segment avec son suffixe,
 * jamais le chemin complet. Un projet qui EST son espace de travail a `dir === root`, donc le nom
 * de l'espace des deux côtés — ce que `"."` veut dire ici.
 */
export function shareProjectName(
  workspaceName: string,
  projectPath: string,
): string {
  if (projectPath === "." || projectPath === "")
    return workspaceName.split("/").pop() ?? workspaceName;
  return projectPath.split("/").pop() ?? projectPath;
}

/**
 * Les partages de ce projet, révoqués compris.
 *
 * Les révoqués restent : la ligne datée est ce qui répond « oui, ça a existé et c'est retiré », et
 * la faire disparaître du seul écran qui la montre laisse son auteur se le demander.
 *
 * **Deux projets du même nom dans deux dossiers d'un même espace sont indiscernables**, parce que
 * `origin` ne porte qu'un basename. Ils voient donc les mêmes lignes. Élargir la comparaison
 * demanderait que la machine écrive le chemin, ce qui se règle là-bas et pas ici.
 */
export function sharesOf(
  shares: ShareSummary[],
  workspaceName: string,
  projectPath: string,
): ShareSummary[] {
  const name = shareProjectName(workspaceName, projectPath);
  return shares.filter(
    (s) => s.origin.repo === workspaceName && s.origin.project === name,
  );
}

/** Ce que le bouton affiche : les partages VIVANTS, les seuls qui coûtent des octets. */
export const liveCount = (shares: ShareSummary[]): number =>
  shares.filter((s) => !s.revokedAt).length;
