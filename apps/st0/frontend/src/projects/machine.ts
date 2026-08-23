// machine.ts — creating and deleting a project go through the MACHINE: that is where the working
// copy being committed lives, and pl8 has only ever held the register of repositories.
// `ensureWorkspace` is what clones, and now also serves ADDING one. See ../../docs/projects.md.

import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import { engineMachine, type Machine } from "./api";
import { commitOutcome } from "./commitOutcome";

export type { Machine };

/** Often enough that git's progress moves on screen, rarely enough not to hammer the machine. */
const CLONE_POLL_MS = 800;

/** A clone still running after this is not a wait any more, it is a failure. */
const CLONE_CAP_MS = 10 * 60_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * This repository's workspace on this machine, cloned if it is not there yet.
 *
 * Cloning lives here because it is the only way to create a project in an EMPTY repository —
 * otherwise you would need a project to open one in order to create one. `onStep` relays git's
 * own words, not ours: a thirty-second wait that says nothing reads as a frozen screen.
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
    // Forgotten by the machine: claiming it succeeded would be worse than failing here.
    if (!next) throw new Error("la machine a oublié ce clonage — réessayez");
    job = next;
    onStep(
      job.percent === null
        ? job.phase || "clonage…"
        : `${job.phase} ${job.percent}%`,
    );
  }
  if (job.failed)
    // git's words verbatim: "Permission denied (publickey)" is the whole answer.
    throw new Error(job.error || job.lines.slice(-1)[0] || "clonage échoué");
  return job.workspace;
}

/** Commit and push what was just done, returning the gripe if there is one. The verb is
 *  `project commit`, not `commit`: a line matching no command answers "unknown command". */
export async function commitAndPush(
  m: Machine,
  workspace: string,
  message: string,
): Promise<string | null> {
  const out = await engineMachine.command(
    m,
    workspace,
    // The message is the rest of the line, unquoted; a newline would make it two commands.
    `project commit ${message.replace(/[\r\n]+/g, " ")}`,
  );
  return commitOutcome(out);
}

/** Create a project: clone if needed, scaffold, commit. The commit comes AFTER and its failure
 *  does not undo the creation — deleting the folder to look tidy would throw work away. */
export async function createProjectOnMachine(
  m: Machine,
  /** The workspace folder on THIS machine — the page already holds it, so nothing resolves a
   *  URI or ensures a clone here. `ensureWorkspace` still serves, but for ADDING a repository. */
  workspace: string,
  folder: string,
  onStep: (s: string) => void,
  /** Which template to write: `arrangement`, `mix` or `video`. */
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

/** …and delete one. The service recycles it; the COMMIT is what removes it from the repository,
 *  and so from every other machine. */
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
