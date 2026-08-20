// machine.ts — créer et supprimer un projet passent par la MACHINE : c'est là que vit la copie
// de travail qu'on committe, et pl8 n'a jamais tenu que le registre des dépôts. `ensureWorkspace`
// est ce qui clone, et sert désormais à l'AJOUT d'un dépôt. Voir ../../docs/projects.md.

import type { ProjectShape } from "@studio/song/yaml/projectSchema";
import { engineMachine, type Machine } from "./api";
import { commitOutcome } from "./commitOutcome";

export type { Machine };

/** Assez souvent pour que la progression de git bouge à l'écran, assez rare pour ne pas
 *  marteler une machine qui, elle, travaille. */
const CLONE_POLL_MS = 800;

/** Un clone qui n'a pas fini au bout de ça n'est plus une attente, c'est une panne. */
const CLONE_CAP_MS = 10 * 60_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * L'espace de travail de ce dépôt sur cette machine, cloné s'il n'y est pas encore.
 *
 * Le clonage est ici et pas ailleurs parce que c'est le seul moyen de créer un projet dans un
 * dépôt **vide** : sans lui il faudrait déjà avoir un projet pour pouvoir en ouvrir un, donc
 * pour pouvoir en créer un — un œuf sans poule.
 *
 * `onStep` reçoit les mots de git, pas les nôtres : « Receiving objects », « Resolving
 * deltas ». Une attente de trente secondes qui ne dit rien ressemble à un écran figé.
 */
export async function ensureWorkspace(
  m: Machine,
  uri: string,
  onStep: (s: string) => void,
): Promise<string> {
  const already = await engineMachine.workspaceForRepo(m, uri);
  if (already) return already;

  onStep("clonage du dépôt sur la machine…");
  let job = await engineMachine.startClone(m, uri);
  const until = Date.now() + CLONE_CAP_MS;
  while (!job.done) {
    if (Date.now() > until)
      throw new Error(
        "le clonage n'en finit pas — voir les journaux de la machine",
      );
    await sleep(CLONE_POLL_MS);
    const next = await engineMachine.cloneJob(m, job.id);
    // Oublié par la machine : elle ne tient les jobs terminés que quelques minutes. On ne peut
    // plus dire comment il s'est fini, et prétendre qu'il a réussi serait pire que d'échouer.
    if (!next) throw new Error("la machine a oublié ce clonage — réessayez");
    job = next;
    onStep(
      job.percent === null
        ? job.phase || "clonage…"
        : `${job.phase} ${job.percent}%`,
    );
  }
  if (job.failed)
    // Les mots de git, tels quels : « Permission denied (publickey) » est la réponse entière.
    throw new Error(job.error || job.lines.slice(-1)[0] || "clonage échoué");
  return job.workspace;
}

/**
 * Committer et pousser ce qui vient d'être fait, en rendant la plainte s'il y en a une.
 *
 * Le verbe est **`project commit`** et non `commit` — c'est ce que déclare
 * `packages/commands/commands.yaml`, et une ligne qui ne correspond à aucune commande ne lève
 * pas : elle répond « unknown command ».
 */
export async function commitAndPush(
  m: Machine,
  workspace: string,
  message: string,
): Promise<string | null> {
  const out = await engineMachine.command(
    m,
    workspace,
    // Le message est le reste de la ligne, sans guillemets ; un retour à la ligne en ferait
    // deux commandes.
    `project commit ${message.replace(/[\r\n]+/g, " ")}`,
  );
  return commitOutcome(out);
}

/**
 * Créer un projet : cloner si besoin, échafauder, committer.
 *
 * L'ordre compte. Le commit vient APRÈS, et son échec n'annule pas la création : le dossier est
 * là, sur la machine, et le dire vaut mieux que de le supprimer pour faire propre — ce serait
 * jeter le travail de quelqu'un pour une panne de réseau.
 */
export async function createProjectOnMachine(
  m: Machine,
  /** Le dossier d'espace de travail sur CETTE machine. La page le tient déjà : c'est la machine
   *  qui a listé la rangée d'où part ce clic, donc il n'y a plus ni URI à résoudre ni clone à
   *  s'assurer ici. `ensureWorkspace` sert encore, mais à l'AJOUT d'un dépôt. */
  workspace: string,
  folder: string,
  onStep: (s: string) => void,
  /** Quel gabarit écrire : `arrangement`, `mix` ou `video`. */
  shape: ProjectShape,
): Promise<{ project: string; gripe: string | null }> {
  onStep(`création de ${folder}…`);
  const project = await engineMachine.createProject(
    m,
    workspace,
    folder,
    shape,
  );
  onStep("commit et envoi…");
  return {
    project,
    gripe: await commitAndPush(m, workspace, `new project ${folder}`),
  };
}

/** …et le supprimer. Le service le recycle (corbeille) ; c'est le commit qui le retire du
 *  dépôt, donc des autres machines. */
export async function deleteProjectOnMachine(
  m: Machine,
  workspace: string,
  path: string,
  onStep: (s: string) => void,
): Promise<{ gripe: string | null }> {
  onStep(`suppression de ${path}…`);
  await engineMachine.deleteProject(m, workspace, path);
  onStep("commit et envoi…");
  return { gripe: await commitAndPush(m, workspace, `delete project ${path}`) };
}
