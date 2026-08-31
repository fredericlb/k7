// bundle.ts — the binaries and assets vendored into a packaged app, resolved relative to
// the app's executable directory (nothing is looked up on PATH — a double-clicked app has
// none), or to a root the host HANDS OVER when it knows better. In a DEV run they answer
// null, routing the caller to the repo's own copy — except the file service, whose checkout
// tier this file resolves itself so that `studio-engine` needs no build to be whole.

import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const exeDir = (): string => dirname(process.execPath);

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

function file(...candidates: string[]): string | null {
  for (const p of candidates) {
    try {
      if (statSync(p).isFile()) return p;
    } catch {
      /* not there — try the next candidate */
    }
  }
  return null;
}

function dir(...candidates: string[]): string | null {
  for (const p of candidates) {
    try {
      if (statSync(p).isDirectory()) return p;
    } catch {
      /* not there */
    }
  }
  return null;
}

const exe = (name: string): string =>
  process.platform === "win32" ? `${name}.exe` : name;

// A packaged resource lands in Contents/Resources on macOS and beside the exe elsewhere: probe both.
function resource(name: string): string | null {
  const d = exeDir();
  return file(
    ...(staged ? [join(staged, name)] : []),
    join(d, "..", "Resources", name),
    join(d, "..", "Resources", "resources", name),
    join(d, name),
    join(d, "resources", name),
  );
}

/** The vendored `node`: a sibling of the bundle, and the file service's runtime — nothing else runs under it now. */
function vendoredNode(): string | null {
  return file(
    ...(staged ? [join(staged, exe("node"))] : []),
    join(exeDir(), exe("node")),
  );
}

/** `packages/engine-host/src`, or null once this file has been bundled to CJS — reading `import.meta` there must not throw. */
function sourceDir(): string | null {
  const url: string | undefined = import.meta.url;
  if (!url) return null;
  try {
    return dirname(fileURLToPath(url));
  } catch {
    return null;
  }
}

/** The file service's own source, when a checkout is around it: src → engine-host → packages → the root. */
function repoFileService(): string | null {
  const here = sourceDir();
  const root = repo ?? (here ? join(here, "..", "..", "..") : null);
  return root
    ? file(join(root, "packages", "file-service", "src", "server.ts"))
    : null;
}

/** Our own entry, when it IS TypeScript: the proof that this runtime reads source, so a child under it will too. */
function tsRuntimeFlags(): string[] | null {
  return process.argv[1]?.endsWith(".ts") ? [...process.execArgv] : null;
}

/** How to run the file service: the packaged pair, else the checkout's source — see docs/supervisorPolicy.md. */
export function fileServiceRuntime(): { node: string; args: string[] } | null {
  const node = vendoredNode();
  const script = node ? resource("file-service.mjs") : null;
  if (node && script) return { node, args: [script] };
  const source = repoFileService();
  const flags = source ? tsRuntimeFlags() : null;
  // Our own interpreter and our own loader flags: the child reads TypeScript exactly the way we were taught to.
  return source && flags
    ? { node: process.execPath, args: [...flags, source] }
    : null;
}

/** The demo songs staged into the bundle; without them a double-clicked app has no repo to copy from and every new workspace opens empty. */
export function demos(): string | null {
  const d = exeDir();
  return dir(
    ...(staged ? [join(staged, "songs")] : []),
    join(d, "..", "Resources", "songs"),
    join(d, "..", "Resources", "resources", "songs"),
    join(d, "songs"),
    join(d, "resources", "songs"),
  );
}
