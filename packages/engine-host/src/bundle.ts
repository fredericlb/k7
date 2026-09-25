// bundle.ts — where a packaged app's binaries were staged, and where the checkout is in a dev run,
// as the host HANDS THEM OVER: embedded, `process.execPath` is the host's rather than ours, and a
// bundled caller cannot walk up from its own path. The probes themselves live with what they find
// (`findEngineBinary`). See docs/supervisorPolicy.md.

/** Where the staged bundle is, when the caller knows — see docs/supervisorPolicy.md. */
let staged: string | null = null;

/** Told rather than guessed: embedded, `process.execPath` is the HOST — see docs/supervisorPolicy.md. */
export function setBundleRoot(dir: string | null): void {
  staged = dir;
}

/** …read back, for the one probe that lives in another package (`findEngineBinary`). */
export function bundleRoot(): string | null {
  return staged;
}

/** The CHECKOUT, in a dev run, for the same reason: a bundled caller cannot walk up from itself. */
let repo: string | null = null;

export function setRepoRoot(dir: string | null): void {
  repo = dir;
}

export function repoRoot(): string | null {
  return repo;
}
