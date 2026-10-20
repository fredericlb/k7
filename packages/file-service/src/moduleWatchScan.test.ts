// The engine's scan lives OUTSIDE every watched root, and the hub writes it from another process:
// no watcher hears it, so a held module stamp must still notice it changed.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, expect, it, vi } from "vitest";

// Before the imports below: EXTS_PATH is read from $STUDIO_HOME when @studio/song loads.
const home = mkdtempSync(join(tmpdir(), "module-watch-home-"));
process.env.STUDIO_HOME = home;

const { loadModuleRefs } = await import("@studio/song/loader");
const { setFoldersStill } = await import("@studio/song/moduleCache");
const { closeModuleWatch, moduleFoldersStill, watchModuleFolders } =
  await import("./moduleWatch.ts");

const root = mkdtempSync(join(tmpdir(), "module-watch-scan-"));
const dir = join(root, "song.k7");
mkdirSync(join(dir, "nodes"), { recursive: true });
writeFileSync(join(dir, "project.k7x"), 'project({ name: "t" })\n', "utf8");

afterEach(() => {
  closeModuleWatch();
  setFoldersStill(null);
  vi.useRealTimers();
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

it("sees a scan the hub wrote while the watcher claims nothing moved", () => {
  // Old enough for the first read to be memoised, as on a service that has run a while.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 5_000);
  watchModuleFolders(dir);
  setFoldersStill(moduleFoldersStill);
  const before = loadModuleRefs(dir);
  // No scan yet: the built-ins stand in, and nothing external is known.
  expect(before["@engine/surge-xt"]).toBeDefined();
  expect(before["@engine/serum"]).toBeUndefined();
  moduleFoldersStill(dir); // settle: from here it would claim nothing moved
  writeFileSync(
    join(home, "exts.json"),
    JSON.stringify({
      entries: [
        { plugins: [{ name: "Serum", format: "VST3", role: "instrument" }] },
      ],
    }),
    "utf8",
  );
  expect(loadModuleRefs(dir)["@engine/serum"]).toBeDefined();
});
