import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProject } from "./project";

// Compile real fixture songs end-to-end and snapshot the result, so ANY change in the
// compiler's output is a visible diff to review — the strongest guard against silent
// drift, and the net a refactor of the module model is held against.
//
// TWO songs, because they cover different halves of the merge. `synth-demo` has two
// INSTANCES of one module (the params/preset path); `rack-demo` has a module that
// `extends` another and merges its rack SYMBOLS per symbol — the most merge-sensitive
// structure the engine ever receives, and the one thing synth-demo cannot show. The
// other two shipped demos have no `modules/` at all.
const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const SONGS = join(here, "..", "..", "..", "apps", "capot", "songs");

// Blank absolute paths (resolved clip sources, .vstpreset paths, recordDir) — those
// are machine-specific, so the snapshot captures structure and logic, not this
// checkout's location on disk.
// POSIX (/...), Windows drive-letter (C:\... or C:/...), and UNC (\\server\...)
const ABS_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;

function normalize(doc: unknown): unknown {
  return JSON.parse(
    JSON.stringify(doc, (_k, v) =>
      typeof v === "string" && ABS_PATH.test(v) ? "<abs>" : v,
    ),
  );
}

describe.each(["synth-demo", "rack-demo"])("golden compile: %s", (song) => {
  it("compiles to a stable ProjectDoc (run `vitest -u` to update after an intended change)", () => {
    expect(normalize(loadProject(join(SONGS, song)))).toMatchSnapshot();
  });
});
