// bundle.ts — the binaries and assets vendored into a packaged app, resolved relative to
// the app's executable directory (nothing is looked up on PATH — a double-clicked app has
// none). In a DEV run every function returns null, which is the intended answer: it routes
// the caller to the repo's own copy.

import { statSync } from "node:fs";
import { dirname, join } from "node:path";

const exeDir = (): string => dirname(process.execPath);

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

// A Tauri resource lands in Contents/Resources on macOS and beside the exe elsewhere: probe both.
function resource(name: string): string | null {
  const d = exeDir();
  return file(
    join(d, "..", "Resources", name),
    join(d, "..", "Resources", "resources", name),
    join(d, name),
    join(d, "resources", name),
  );
}

/** The vendored `node` — us, when packaged. Null when running under a PATH node. */
export function vendoredNode(): string | null {
  return file(join(exeDir(), exe("node")));
}

/** The (node, file-service.mjs) pair if this is a packaged app; null in dev, which is load-bearing — the watcher owns that port. */
export function fileServiceRuntime(): { node: string; script: string } | null {
  const node = vendoredNode();
  if (!node) return null;
  const script = resource("file-service.mjs");
  return script ? { node, script } : null;
}

/** The demo songs staged into the bundle; without them a double-clicked app has no repo to copy from and every new workspace opens empty. */
export function demos(): string | null {
  const d = exeDir();
  return dir(
    join(d, "..", "Resources", "songs"),
    join(d, "..", "Resources", "resources", "songs"),
    join(d, "songs"),
    join(d, "resources", "songs"),
  );
}
