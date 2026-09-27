// A developer running these tests has a real `$STUDIO_HOME`, where the account's libraries are
// cloned, and a real médiathèque: both are pinned at folders that do not exist, as @studio/song's
// are. A test that wants a library points `$STUDIO_HOME` at its own temp folder (@studio/song's
// testSupport `librariesFixture`).

import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // A package config REPLACES the root one, so the disk timeout is repeated here — docs/tests.md.
  test: {
    env: {
      STUDIO_MEDIATEK: join(tmpdir(), "studio-passes-no-mediatek"),
      STUDIO_HOME: join(tmpdir(), "studio-passes-no-home"),
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
