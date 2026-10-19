// rustSources.mjs — one hash over every file the WebAssembly module is built from, so a stale src/k7xWasm.generated.ts is caught.
// A reader would get wrong what it covers: rust/src, the manifest and the lock file, with line endings folded so a Windows checkout agrees.

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
  const all = [
    join(RUST, "Cargo.toml"),
    join(RUST, "Cargo.lock"),
    ...files(join(RUST, "src")),
  ];
  for (const f of all) {
    const rel = relative(RUST, f).replaceAll("\\", "/");
    hash.update(
      `${rel}\0${readFileSync(f, "utf8").replaceAll("\r\n", "\n")}\0`,
    );
  }
  return hash.digest("hex").slice(0, 16);
}
