import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProject } from "./project";

// Two fixture songs snapshotted whole: one covers the params/preset merge, the other rack SYMBOLS.
const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const SONGS = join(here, "..", "..", "..", "demos");

// Blank absolute paths — POSIX, drive-letter and UNC — so the snapshot is not this checkout's.
const ABS_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;

function normalize(doc: unknown): unknown {
  return JSON.parse(
    JSON.stringify(doc, (_k, v) =>
      typeof v === "string" && ABS_PATH.test(v) ? "<abs>" : v,
    ),
  );
}

// The SNAPSHOT KEY without `.st0`: carrying the suffix in would rewrite every snapshot on a rename.
describe.each(["synth-demo", "rack-demo"])("golden compile: %s", (song) => {
  it("compiles to a stable ProjectDoc (run `vitest -u` to update after an intended change)", () => {
    expect(
      normalize(loadProject(join(SONGS, `${song}.st0`))),
    ).toMatchSnapshot();
  });
});
