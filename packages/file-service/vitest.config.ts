// Two ambient inputs are pinned at folders that do not exist, so no test reads or writes the
// developer's own state: `$STUDIO_MEDIATEK` (every project load mounts the media library) and
// `$STUDIO_HOME` (it wins over HOME, and a WSL dev shell points it at the host's workspaces).
// A test wanting either sets it itself; `forks` keeps that from leaking into another file.
// See docs/tests.md.

import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // A package config REPLACES the root one, so the disk timeout is repeated here — docs/tests.md.
  test: {
    env: {
      STUDIO_MEDIATEK: join(tmpdir(), "studio-fs-no-mediatek"),
      STUDIO_HOME: join(tmpdir(), "studio-fs-no-home"),
    },
    pool: "forks",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
