// machine.ts — creating and deleting a project go through the MACHINE: that is where the working
// copy being committed lives, and pl8 has only ever held the register of repositories.
// `ensureWorkspace` is what clones, and also serves ADDING one. See ../../docs/projects.md.

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

/** This repository's workspace on this machine, cloned if it is not there — the only way to create a project in an EMPTY repository. */
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

/**
 * Commit and push what was just done, returning the gripe if there is one — `project commit`,
 * since a bare `commit` names no command. `noRemote` says the workspace has never been
 * published, where a failed push is the ordinary state rather than news.
 */
export async function commitAndPush(
  m: Machine,
  workspace: string,
  message: string,
  noRemote = false,
): Promise<string | null> {
  const out = await engineMachine.command(
    m,
    workspace,
    // The message is the rest of the line, unquoted; a newline would make it two commands.
    `project commit ${message.replace(/[\r\n]+/g, " ")}`,
  );
  return commitOutcome(out, { noRemote });
}

/**
 * A workspace of one's own: git-initialised on the machine, with no repository behind it and
 * NOTHING in it. Nothing here needs a server, which is the point — and no project either,
 * because choosing an archetype is a question the editor asks better, on the empty workspace
 * itself. See ../../docs/projects.md.
 */
export async function createLocalWorkspace(
  m: Machine,
  name: string,
  onStep: (s: string) => void,
): Promise<{ workspace: string }> {
  onStep(`création de ${name}…`);
  await engineMachine.createWorkspace(m, name);
  return { workspace: name };
}

/**
 * Its FIRST repository: the remote and the push in one call on the machine, then the register
 * on pl8 — which is what makes `/<dépôt>/<projet>` resolve. The push is the half that can
 * fail loudly; the register is the half that can be done later.
 */
export async function publishWorkspace(
  m: Machine,
  workspace: string,
  uri: string,
  onStep: (s: string) => void,
  register: (uri: string) => Promise<unknown>,
): Promise<{ registered: boolean }> {
  onStep("envoi vers le dépôt…");
  await engineMachine.setRemote(m, workspace, uri);
  onStep("inscription du dépôt…");
  try {
    await register(uri);
    return { registered: true };
  } catch {
    // The push LANDED. Saying it failed would send someone to redo the one half that worked.
    return { registered: false };
  }
}

/** Create a project: clone if needed, scaffold, commit — and a failed commit does not undo the creation. */
export async function createProjectOnMachine(
  m: Machine,
  /** The workspace folder on THIS machine — the page already holds it; `ensureWorkspace` still serves, but for ADDING a repository. */
  workspace: string,
  folder: string,
  onStep: (s: string) => void,
  /** Which template to write: `arrangement`, `mix` or `video`. */
  shape: ProjectShape,
  /** The workspace has no repository yet, so the push cannot land and must not be reported. */
  noRemote = false,
): Promise<{ project: string; gripe: string | null }> {
  onStep(`création de ${folder}…`);
  const project = await engineMachine.createProject(
    m,
    workspace,
    folder,
    shape,
  );
  onStep(noRemote ? "commit…" : "commit et envoi…");
  return {
    project,
    gripe: await commitAndPush(m, workspace, `new project ${folder}`, noRemote),
  };
}

/** …and delete one: the service recycles it, and the COMMIT is what removes it from the repository and from every other machine. */
export async function deleteProjectOnMachine(
  m: Machine,
  workspace: string,
  path: string,
  onStep: (s: string) => void,
  noRemote = false,
): Promise<{ gripe: string | null }> {
  onStep(`suppression de ${path}…`);
  await engineMachine.deleteProject(m, workspace, path);
  onStep(noRemote ? "commit…" : "commit et envoi…");
  return {
    gripe: await commitAndPush(
      m,
      workspace,
      `delete project ${path}`,
      noRemote,
    ),
  };
}
