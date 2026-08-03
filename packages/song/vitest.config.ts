// The machine's media library is mounted by every `loadModuleRefs` call now, declared or not
// (see sharedFolders.mediatekModulesRoot), which makes `~/.studio/mediatek` an ambient input to
// most of this package's tests — a developer with a real library would watch their own modules
// appear in assertions about a three-module fixture. So it is pinned, once, at a folder that
// does not exist; a test that wants a médiathèque writes one and sets $STUDIO_MEDIATEK itself.

import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { env: { STUDIO_MEDIATEK: join(tmpdir(), "studio-song-no-mediatek") } },
});
