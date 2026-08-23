// uri.ts — the SSH git URI vocabulary, shared by everything that names a repository:
// `assertSshGitUri` decides whether a string may reach `git` at all, and `normalizeGitUri`
// folds the two spellings of one repository into a single comparison key. Pure — no Node
// imports — so a browser can validate a paste with the same rule the servers apply.

// SSH ONLY, anchored on an alphanumeric first char so a URI never reaches git looking like an option — see docs/keys.md.
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

/** One repository's identity as `host[:port]/path`, so the two spellings of one repo meet — docs/keys.md. */
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
  return repoNameOfKey(normalizeGitUri(uri));
}

/** The same short name out of a KEY, which is no longer an SSH URI and would throw in `repoName`. */
export function repoNameOfKey(key: string): string {
  return key.split("/").filter(Boolean).pop() ?? "";
}
