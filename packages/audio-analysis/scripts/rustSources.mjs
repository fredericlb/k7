// rustSources.mjs — one hash over every file the WebAssembly measure is built from, so a stale src/waveformWasm.generated.ts is caught.
// A reader would get wrong what it covers: rust/src and the manifest, with line endings folded so a Windows checkout agrees.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RUST = join(import.meta.dirname, "..", "rust");

function files(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const abs = join(dir, name);
      return statSync(abs).isDirectory() ? files(abs) : [abs];
    });
}

export function rustSourceHash() {
  const hash = createHash("sha256");
  for (const f of [join(RUST, "Cargo.toml"), ...files(join(RUST, "src"))]) {
    const rel = relative(RUST, f).replaceAll("\\", "/");
    hash.update(
      `${rel}\0${readFileSync(f, "utf8").replaceAll("\r\n", "\n")}\0`,
    );
  }
  return hash.digest("hex").slice(0, 16);
}
