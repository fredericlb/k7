// machine.ts — creating, copying and deleting a project go through the MACHINE: that is where the
// working copy being committed lives, and pl8 has only ever held the register of repositories.
// `ensureWorkspace` is what clones, and also serves ADDING one. See ../../docs/projects.md.

import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
// `m` is the MACHINE in every function here, so the catalogue comes in under its own name.
import { m as msg } from "../paraglide/messages.js";
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
/**
 * git's ANSWER out of everything it wrote: the last two non-empty lines. A failed clone ends
 * with the reason and then the fatal that followed from it — "Permission denied (publickey)."
 * before "fatal: Could not read from remote repository." — and either alone is half the story.
 * The rest is a log, and a log belongs in the console (../../docs/projects.md).
 */
export function gitReason(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length <= 2)
    return lines.join(" — ") || msg["machine.cloneFailed"]();
  return msg["machine.cloneTail"]({ lines: lines.slice(-2).join(" — ") });
}

export async function ensureWorkspace(
  m: Machine,
  uri: string,
  onStep: (s: string) => void,
): Promise<string> {
  const already = await engineMachine.workspaceForRepo(m, uri);
  if (already) return already;

  onStep(msg["machine.cloning"]());
  let job = await engineMachine.startClone(m, uri);
  const until = Date.now() + CLONE_CAP_MS;
  // Git's own words go to the CONSOLE and not to the screen: they are a log, and a log flickering
  // through a dialog is unreadable while it runs and gone once it works — docs/projects.md.
  // `lines` is the last few and `emitted` is the count, so what was missed is arithmetic rather
  // than a guess — git repeats its counter lines, and matching on text would skip a whole run.
  let logged = 0;
  while (!job.done) {
    if (Date.now() > until)
      // The MACHINE is still cloning: only this page gave up, and the workspace appears by
      // itself when git is done — nothing is removed for taking long (docs/projects.md).
      throw new Error(msg["machine.cloneSlow"]());
    await sleep(CLONE_POLL_MS);
    const next = await engineMachine.cloneJob(m, job.id);
    // Forgotten by the machine: claiming it succeeded would be worse than failing here.
    if (!next) throw new Error(msg["machine.cloneForgotten"]());
    job = next;
    const missed = job.emitted - logged - job.lines.length;
    if (missed > 0)
      console.debug(`git: …(${missed} lines the machine no longer holds)`);
    for (const line of job.lines.slice(
      Math.max(0, logged - (job.emitted - job.lines.length)),
    ))
      console.debug("git:", line);
    logged = job.emitted;
    // A PERCENTAGE is progress; anything else is that log, and the screen says only that work goes on.
    onStep(job.percent === null ? "clonage…" : `${job.phase} ${job.percent}%`);
  }
  if (job.failed) {
    const said =
      job.error || job.lines.slice(-1)[0] || msg["machine.cloneFailed"]();
    // The WHOLE of it in the console; a failed clone can carry two hundred lines of git.
    console.debug("git:", said);
    throw new Error(gitReason(said));
  }
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
  onStep(msg["machine.creating"]({ name }));
  await engineMachine.createWorkspace(m, name);
  return { workspace: name };
}

/** Its FIRST repository: the remote and the push in one call on the machine, which is the whole of publishing. */
export async function publishWorkspace(
  m: Machine,
  workspace: string,
  uri: string,
  onStep: (s: string) => void,
): Promise<void> {
  onStep(msg["machine.pushing"]());
  await engineMachine.setRemote(m, workspace, uri);
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
  onStep(msg["machine.creating"]({ name: folder }));
  const project = await engineMachine.createProject(
    m,
    workspace,
    folder,
    shape,
  );
  onStep(
    noRemote ? msg["machine.committing"]() : msg["machine.committingPushing"](),
  );
  return {
    project,
    gripe: await commitAndPush(m, workspace, `new project ${folder}`, noRemote),
  };
}

/**
 * Copy a project into ANOTHER workspace: the copy on the machine, then the DESTINATION's commit
 * — a copy is a change to the workspace that receives it, and the push is what carries it off
 * this disk. `noRemote` is that workspace having no repository, where there is nothing to push.
 */
export async function copyProjectOnMachine(
  m: Machine,
  from: string,
  path: string,
  to: string,
  name: string,
  onStep: (s: string) => void,
  noRemote = false,
): Promise<{ project: string; gripe: string | null }> {
  onStep(msg["machine.copying"]({ path, to }));
  const project = await engineMachine.copyProject(m, from, path, to, name);
  onStep(
    noRemote ? msg["machine.committing"]() : msg["machine.committingPushing"](),
  );
  return {
    project,
    gripe: await commitAndPush(m, to, `copy project ${project}`, noRemote),
  };
}

/**
 * …and rename one: the folder moves on the machine, then the workspace commits — a rename is a
 * DELETE and an ADD to git, so what carries it off this disk is the push, exactly as a copy's is.
 */
export async function renameProjectOnMachine(
  m: Machine,
  workspace: string,
  path: string,
  name: string,
  onStep: (s: string) => void,
  noRemote = false,
): Promise<{ project: string; gripe: string | null }> {
  onStep(msg["machine.renaming"]({ path, name }));
  const project = await engineMachine.renameProject(m, workspace, path, name);
  onStep(
    noRemote ? msg["machine.committing"]() : msg["machine.committingPushing"](),
  );
  return {
    project,
    gripe: await commitAndPush(
      m,
      workspace,
      `rename project ${path} -> ${project}`,
      noRemote,
    ),
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
  onStep(msg["machine.deleting"]({ path }));
  await engineMachine.deleteProject(m, workspace, path);
  onStep(
    noRemote ? msg["machine.committing"]() : msg["machine.committingPushing"](),
  );
  return {
    gripe: await commitAndPush(
      m,
      workspace,
      `delete project ${path}`,
      noRemote,
    ),
  };
}
