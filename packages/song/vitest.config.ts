// `mediatekRoot()` reads `$STUDIO_MEDIATEK`, and a developer running these tests has a real
// médiathèque on the machine. Modules come from a submodule in each test's own temp workspace
// (see testSupport's writeLibraries); songs and samples come from the médiathèque, so it is
// pinned, once, at a folder that does not exist. A test that wants one writes it and sets the
// variable itself.

import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { env: { STUDIO_MEDIATEK: join(tmpdir(), "studio-song-no-mediatek") } },
});
