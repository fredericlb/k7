// store.ts — the repositories one person has added, as one small JSON per OIDC subject on
// the library volume, plus where that person's deploy key lives. No database:
// the same arrangement `@studio/user-prefs` uses, and for the same reasons — see
// packages/user-prefs/docs/store.md and ../../docs/projects.md.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeGitUri, repoName } from "@studio/git-repos/uri";
import { mediatekDir } from "@studio/mediatek/layout";
import { fileFor } from "@studio/user-prefs";

export interface RepoRecord {
  /** Stable across spellings: derived from the NORMALIZED uri, so adding the same repo twice is idempotent. */
  id: string;
  /** As it was pasted — this is what gets handed to git, and to st0. */
  uri: string;
  label: string;
  addedAt: string;
}

/** A dot-directory, so `writablePath` refuses it and no family scan ever walks it. */
export function projectsDir(): string {
  return process.env.STUDIO_PROJECTS_DIR || join(mediatekDir(), ".projects");
}

/** One directory per user, named exactly as their prefs file is — minus the extension. */
function userDir(sub: string): string {
  return fileFor(sub).replace(/\.json$/, "");
}

export function keyDirFor(sub: string): string {
  return join(projectsDir(), "ssh", userDir(sub));
}

function listPath(sub: string): string {
  return join(projectsDir(), "repos", fileFor(sub));
}

/** The id for a uri. Throws on anything `assertSshGitUri` refuses — an id for nothing. */
export function repoIdFor(uri: string): string {
  return createHash("sha256")
    .update(normalizeGitUri(uri))
    .digest("hex")
    .slice(0, 12);
}

/** Bumped on every write: two inside one timestamp tick are invisible to the revision below. */
let mutations = 0;

/** What one person's file holds: their project repositories, and the one library repository. */
interface RepoFile {
  repos?: RepoRecord[];
  /** See `librariesRepo`. Absent — not `[]` — because there is exactly one or none. */
  libraries?: RepoRecord | null;
}

/** Reads never throw: an absent file is "none yet", which is a real state and not a fault. */
function read(sub: string): RepoFile {
  try {
    return JSON.parse(readFileSync(listPath(sub), "utf8")) as RepoFile;
  } catch {
    return {};
  }
}

/** This user's project repositories. */
export function listRepos(sub: string): RepoRecord[] {
  const raw = read(sub).repos;
  return Array.isArray(raw) ? raw : [];
}

/** The LIBRARY repository: one or none, in the same file as the rest — ../../docs/projects.md. */
export function librariesRepo(sub: string): RepoRecord | null {
  return read(sub).libraries ?? null;
}

export function findRepo(sub: string, id: string): RepoRecord | null {
  return listRepos(sub).find((r) => r.id === id) ?? null;
}

/** The short name in a project's address — the last path segment, no `.git`. See RepoSummary. */
export const nameOf = (r: RepoRecord): string => repoName(r.uri);

/** Every repository answering to a short name — PLURAL, so a tie is refused rather than picked. */
export function findReposByName(sub: string, name: string): RepoRecord[] {
  return listRepos(sub).filter((r) => nameOf(r) === name);
}

/** Writes THROW, unlike the preferences store: this list is the only record a repository has. */
function save(sub: string, next: RepoFile): void {
  const path = listPath(sub);
  mkdirSync(join(projectsDir(), "repos"), { recursive: true });
  // Merged over what is there, so writing one half from one screen cannot drop the other.
  const merged: RepoFile = { ...read(sub), ...next };
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  mutations++;
}

/** Add a repository, or return the one already there — adding twice is not an error. */
export function addRepo(
  sub: string,
  uri: string,
  label?: string,
): { repo: RepoRecord; added: boolean } {
  const id = repoIdFor(uri);
  const repos = listRepos(sub);
  const existing = repos.find((r) => r.id === id);
  if (existing) return { repo: existing, added: false };
  const repo: RepoRecord = {
    id,
    uri: uri.trim(),
    label: label?.trim() || repoName(uri),
    addedAt: new Date().toISOString(),
  };
  save(sub, { repos: [...repos, repo] });
  return { repo, added: true };
}

/** Remove one. False when it was not there — the caller answers 404 rather than lying. */
export function removeRepo(sub: string, id: string): boolean {
  const repos = listRepos(sub);
  const next = repos.filter((r) => r.id !== id);
  if (next.length === repos.length) return false;
  save(sub, { repos: next });
  return true;
}

/** REPLACES rather than appends — every workspace already carries the old one as a submodule. */
export function setLibrariesRepo(sub: string, uri: string): RepoRecord {
  const existing = librariesRepo(sub);
  const id = repoIdFor(uri);
  if (existing?.id === id) return existing; // same repository, whatever the spelling
  const repo: RepoRecord = {
    id,
    uri: uri.trim(),
    label: repoName(uri),
    addedAt: new Date().toISOString(),
  };
  save(sub, { libraries: repo });
  return repo;
}

/** Forget it. False when there was none — the caller answers 404 rather than lying. */
export function clearLibrariesRepo(sub: string): boolean {
  if (!librariesRepo(sub)) return false;
  save(sub, { libraries: null });
  return true;
}

/** This user's change token, for st0's one poll. */
export function revision(sub: string): string {
  let stamp = 0;
  try {
    stamp = Math.floor(statSync(listPath(sub)).mtimeMs);
  } catch {
    /* no file yet — 0 is a fine token for "nothing" */
  }
  return `${mutations}:${stamp}:${listRepos(sub).length}`;
}
