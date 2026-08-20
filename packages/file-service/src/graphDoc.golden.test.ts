import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGraphDoc } from "./graphDoc";

// The same guard project.golden.test.ts gives the ENGINE's doc, for the one the Chains
// tab draws — which nothing snapshotted until now, and which is precisely the surface
// where the module model has drifted: graphDoc resolves a module's base with a raw
// one-level lookup while the compiler walks the whole `extends` chain. A refactor that
// unifies the two has to leave this file's output alone, and there was no way to see it.
//
// Deterministic for these two fixtures: the only machine-dependent input is the plugin
// scan cache, consulted (isPluginScanned) solely for EXTERNAL formats, and both demos
// use `plugin.type: internal` or no plugin at all.
const here = dirname(fileURLToPath(import.meta.url)); // packages/file-service/src
const SONGS = join(here, "..", "..", "..", "engine", "capot", "songs");

// Blank absolute paths — machine-specific, so the snapshot holds structure, not this
// checkout's location. POSIX, Windows drive-letter, and UNC.
const ABS_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;

function normalize(doc: unknown): unknown {
  return JSON.parse(
    JSON.stringify(doc, (_k, v) =>
      typeof v === "string" && ABS_PATH.test(v) ? "<abs>" : v,
    ),
  );
}

// The name here is the SNAPSHOT KEY, and the folder is that plus `.st0` — the suffix that says
// which app opens a project (see packages/web-protocol/projects.ts). Kept apart on purpose:
// carrying it into the key would rewrite every snapshot for a rename that changed no output.
describe.each(["synth-demo", "rack-demo"])("golden WebGraph: %s", (song) => {
  it("builds a stable WebGraph (run `vitest -u` to update after an intended change)", () => {
    expect(
      normalize(buildGraphDoc(join(SONGS, `${song}.st0`))),
    ).toMatchSnapshot();
  });
});
