// uri.ts — the SSH git URI vocabulary, shared by everything that names a repository:
// `assertSshGitUri` decides whether a string may reach `git` at all, and `normalizeGitUri`
// folds the two spellings of one repository into a single comparison key. Pure — no Node
// imports — so a browser can validate a paste with the same rule the servers apply.

// SSH ONLY: the per-user key carries the privilege, and an https URI would sidestep it and hang on a prompt.
// Both shapes anchor on an alphanumeric first char, so a URI can never reach git looking like an option.
const SCP_URI = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:[A-Za-z0-9._~/-]+$/; // git@host:path
const SSH_URL =
  /^ssh:\/\/([A-Za-z0-9._-]+@)?[A-Za-z0-9._-]+(:\d+)?\/[A-Za-z0-9._~/-]+$/;

export function assertSshGitUri(uri: string): void {
  if (!SCP_URI.test(uri) && !SSH_URL.test(uri))
    throw new Error(
      `not an SSH git URI: ${uri} — use git@host:path or ssh://host/path`,
    );
}

/** True for either accepted spelling, for a caller that wants to branch rather than throw. */
export function isSshGitUri(uri: string): boolean {
  return SCP_URI.test(uri) || SSH_URL.test(uri);
}

/**
 * One repository's identity, as `host[:port]/path` with no `.git` and no SSH user.
 *
 * The point is that `git@host:me/repo.git` and `ssh://git@host/me/repo` are the SAME
 * repository, and the two sides of this feature learn about it by different routes — pl8
 * from what a person pasted, the file service from a checkout's `remote.origin.url`, which
 * git may have rewritten. Comparing the raw strings would clone a repo that is already
 * there. See docs/mirror.md.
 *
 * Throws on anything `assertSshGitUri` refuses: a key derived from an unvalidated string
 * would be a key for something that must never be fetched.
 */
export function normalizeGitUri(uri: string): string {
  assertSshGitUri(uri);
  const trimmed = uri.trim();
  let hostPort: string;
  let path: string;
  if (trimmed.startsWith("ssh://")) {
    const rest = trimmed.slice("ssh://".length);
    const slash = rest.indexOf("/");
    const authority = rest.slice(0, slash);
    path = rest.slice(slash + 1);
    hostPort = authority.slice(authority.indexOf("@") + 1);
  } else {
    const colon = trimmed.indexOf(":");
    const authority = trimmed.slice(0, colon);
    path = trimmed.slice(colon + 1);
    hostPort = authority.slice(authority.indexOf("@") + 1);
  }
  // The default port is dropped so `ssh://host:22/p` and `git@host:p` still meet.
  const host = hostPort.replace(/:22$/, "").toLowerCase();
  const clean = path
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  return `${host}/${clean}`;
}

/** The last path segment, without `.git` — the default name for a folder holding this repo. */
export function repoName(uri: string): string {
  const last = normalizeGitUri(uri).split("/").filter(Boolean).pop() ?? "";
  return last;
}
