// The médiathèque is mounted by every project load now, declared or not (see
// `@studio/song`'s sharedFolders.mediatekModulesRoot), so `~/.studio/mediatek` is an ambient
// input to anything here that compiles a project or lists a catalogue — on a developer's
// machine their own modules would turn up inside fixtures asserting "this project sees no
// shared library". Pinned at a folder that does not exist; a test wanting a library writes
// one and sets $STUDIO_MEDIATEK itself.

import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { env: { STUDIO_MEDIATEK: join(tmpdir(), "studio-fs-no-mediatek") } },
});
