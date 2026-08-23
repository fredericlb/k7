import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGraphDoc } from "./graphDoc";

// The guard project.golden.test.ts gives the ENGINE's doc, for the one the Chains tab draws.
const here = dirname(fileURLToPath(import.meta.url)); // packages/file-service/src
const SONGS = join(here, "..", "..", "..", "engine", "capot", "songs");

// Blank absolute paths (POSIX, drive-letter, UNC) so the snapshot holds structure, not a location.
const ABS_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;

function normalize(doc: unknown): unknown {
  return JSON.parse(
    JSON.stringify(doc, (_k, v) =>
      typeof v === "string" && ABS_PATH.test(v) ? "<abs>" : v,
    ),
  );
}

// The name is the SNAPSHOT KEY and the folder is that plus `.st0`, kept apart so a rename rewrites nothing.
describe.each(["synth-demo", "rack-demo"])("golden WebGraph: %s", (song) => {
  it("builds a stable WebGraph (run `vitest -u` to update after an intended change)", () => {
    expect(
      normalize(buildGraphDoc(join(SONGS, `${song}.st0`))),
    ).toMatchSnapshot();
  });
});
