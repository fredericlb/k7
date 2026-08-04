// store.ts — the repositories one person has added, as one small JSON per OIDC subject on
// the library volume, plus where that person's mirrors and deploy key live. No database:
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
  /** As it was pasted — this is what gets handed to git, and to l8. */
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

export function mirrorDirFor(sub: string, repoId: string): string {
  return join(projectsDir(), "mirrors", userDir(sub), `${repoId}.git`);
}

function listPath(sub: string): string {
  return join(projectsDir(), "repos", fileFor(sub));
}

/** The id for a uri. Throws on anything `assertSshGitUri` refuses — an id for a repository
 *  that must never be fetched would be an id for nothing. */
export function repoIdFor(uri: string): string {
  return createHash("sha256")
    .update(normalizeGitUri(uri))
    .digest("hex")
    .slice(0, 12);
}

/** Bumped on every write, because two writes inside one filesystem timestamp tick are
 *  otherwise invisible to the revision below — the same trick `@studio/mediatek` plays. */
let mutations = 0;

/** This user's repositories. Reads never throw: an absent file is "none yet", a real state. */
export function listRepos(sub: string): RepoRecord[] {
  try {
    const raw = JSON.parse(readFileSync(listPath(sub), "utf8")) as {
      repos?: RepoRecord[];
    };
    return Array.isArray(raw.repos) ? raw.repos : [];
  } catch {
    return [];
  }
}

export function findRepo(sub: string, id: string): RepoRecord | null {
  return listRepos(sub).find((r) => r.id === id) ?? null;
}

/**
 * Writes THROW, unlike the preferences store this borrows its naming from. Losing a
 * preference costs you a setting you can set again; losing a repository you just added is a
 * 200 for something that did not happen, and the list you are looking at is the only record
 * it ever had.
 */
function save(sub: string, repos: RepoRecord[]): void {
  const path = listPath(sub);
  mkdirSync(join(projectsDir(), "repos"), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ repos }, null, 2)}\n`, "utf8");
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
  save(sub, [...repos, repo]);
  return { repo, added: true };
}

/** Remove one. False when it was not there — the caller answers 404 rather than lying. */
export function removeRepo(sub: string, id: string): boolean {
  const repos = listRepos(sub);
  const next = repos.filter((r) => r.id !== id);
  if (next.length === repos.length) return false;
  save(sub, next);
  return true;
}

/**
 * This user's change token, for the médiathèque's one poll.
 *
 * `bump()` is what a finished mirror fetch calls: the list has not moved, but what a tree
 * request would answer has, and the section would otherwise sit on the listing it got
 * before the clone landed.
 */
export function bump(): void {
  mutations++;
}

export function revision(sub: string): string {
  let stamp = 0;
  try {
    stamp = Math.floor(statSync(listPath(sub)).mtimeMs);
  } catch {
    /* no file yet — 0 is a fine token for "nothing" */
  }
  return `${mutations}:${stamp}:${listRepos(sub).length}`;
}
