// `mediatekRoot()` reads `$STUDIO_MEDIATEK`, and a developer running these tests has a real
// médiathèque on the machine — and a real `$STUDIO_HOME`, where the account's libraries are
// cloned. Both are pinned, once, at folders that do not exist. A test that wants a library points
// `$STUDIO_HOME` at its own temp folder (testSupport's `librariesFixture`); one that wants the
// médiathèque writes it and sets that variable itself.

import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // A package config REPLACES the root one, so the disk timeout is repeated here — docs/tests.md.
  test: {
    env: {
      STUDIO_MEDIATEK: join(tmpdir(), "studio-song-no-mediatek"),
      // …and the machine's state, where the account's LIBRARIES are cloned: a test that wants
      // one points it at its own folder (testSupport's `librariesFixture`).
      STUDIO_HOME: join(tmpdir(), "studio-song-no-home"),
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
