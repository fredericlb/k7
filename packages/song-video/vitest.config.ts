// Same pin as @studio/song's: `mediatekRoot()` reads `$STUDIO_MEDIATEK`, and a developer running
// these tests has a real médiathèque on the machine. The picture compile goes through the song
// loader, so it is pinned, once, at a folder that does not exist. A test that wants one writes it
// and sets the variable itself.

import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // A package config REPLACES the root one, so the disk timeout is repeated here — docs/tests.md.
  test: {
    env: { STUDIO_MEDIATEK: join(tmpdir(), "studio-song-no-mediatek") },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
