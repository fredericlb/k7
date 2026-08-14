// `mediatekRoot()` reads `$STUDIO_MEDIATEK`, and a developer running these tests has a real
// médiathèque on the machine. Modules no longer come from it — they are a submodule in each
// test's own temp workspace (see testSupport's writeLibraries) — but songs and samples still
// do, so it is pinned, once, at a folder that does not exist. A test that wants one writes it
// and sets the variable itself.

import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { env: { STUDIO_MEDIATEK: join(tmpdir(), "studio-song-no-mediatek") } },
});
