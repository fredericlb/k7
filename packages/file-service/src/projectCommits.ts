// projectCommits.ts — the commits that touched one project folder, newest first, each with the
// files it changed PROJECT-relative: the History panel lists them beside the undo journal.
// A workspace with no repository, or no commit yet, has none — never an error.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ProjectCommit } from "@studio/web-protocol";

const run = promisify(execFile);

const QUICK_MS = 10_000;
/** How far back the panel reads: a list, not an archaeology tool. */
export const COMMIT_LIMIT = 200;
// Unit and record separators: a subject may hold anything but these.
const US = "\x1f";
const RS = "\x1e";

/** `project` is the folder's path relative to the repository root, posix. */
export async function projectCommits(
  root: string,
  project: string,
  limit = COMMIT_LIMIT,
): Promise<ProjectCommit[]> {
  if (!existsSync(join(root, ".git"))) return [];
  try {
    const { stdout } = await run(
      "git",
      [
        "log",
        `-n${limit}`,
        `--format=${RS}%H${US}%at${US}%an${US}%s`,
        "--name-only",
        "--",
        project,
      ],
      { cwd: root, timeout: QUICK_MS, maxBuffer: 16 * 1024 * 1024 },
    );
    return parseCommitLog(stdout, project);
  } catch {
    // No HEAD yet, or git gone: a list with nothing in it, which is what the panel can say.
    return [];
  }
}

/** The log above, its paths made relative to `project` and the ones outside it dropped. */
export function parseCommitLog(out: string, project: string): ProjectCommit[] {
  const prefix = `${project.replace(/\/+$/, "")}/`;
  const commits: ProjectCommit[] = [];
  for (const record of out.split(RS)) {
    const [head, ...files] = record.split("\n");
    const [hash, at, author, subject] = head.split(US);
    if (!hash || !at) continue;
    commits.push({
      hash,
      ts: Number(at) * 1000,
      author: author ?? "",
      subject: subject ?? "",
      paths: files
        .map((f) => f.trim())
        .filter((f) => f.startsWith(prefix))
        .map((f) => f.slice(prefix.length)),
    });
  }
  return commits;
}
