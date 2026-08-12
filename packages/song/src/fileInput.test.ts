// An io module whose audio comes off DISK rather than off an interface (`io: file`). What is
// pinned here is that it is a SOURCE — the graph decides "sink" by elimination, so a role
// missing from IO_SOURCES becomes a silent sink and a chain routes into the thing meant to
// feed it. See docs/fileInput.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { engineModules } from "./engineCatalogue";
import { isFileInputModule, isInputModule, loadGraph } from "./graph";
import { engineRef, isIoSource, moduleEmits } from "./moduleTypes";

let dir: string;

/** A file at `rel` under the project, folders created. */
function file(rel: string, body = "x"): void {
  const abs = join(dir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body, "utf8");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-fileio-"));
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: song\n  tempo: 120\n",
    "utf8",
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the file input", () => {
  it("is a source, like a live input and unlike a sink", () => {
    expect(isIoSource("file")).toBe(true);
    expect(isIoSource("in")).toBe(true);
    expect(isIoSource("out")).toBe(false);
    expect(isIoSource("video_out")).toBe(false);
  });

  it("emits audio", () => {
    // Not derivable from the type folder: everything under io/ shares one, and what leaves
    // the module is decided by its role.
    expect(moduleEmits("io", "file")).toBe("audio");
    expect(moduleEmits("io", "out")).toBeUndefined();
  });

  it("is offered by the engine, with no scan behind it", () => {
    const m = engineModules(join(dir, "nope.json"));
    expect(m[engineRef("FILE")]).toMatchObject({ io: "file", kind: "io" });
  });

  it("is NOT a live interface input", () => {
    // The narrower test gates channels, monitoring, trim and the tuner — none of which mean
    // anything for a file. Both emit audio, and that is all they share.
    const m = { kind: "io", io: "file" } as never;
    expect(isFileInputModule(m)).toBe(true);
    expect(isInputModule({} as never, m)).toBe(false);
  });

  it("carries the file it reads, and a chain may leave it unnamed", () => {
    // Absent is the USEFUL case, not an oversight: a chain template's input names no file
    // because whoever applies the template supplies the audio.
    //
    // It is `source:` and not `file:` because the loader already writes the module's FOLDER
    // name to `file` — an authored one was overwritten by the decoration, silently, which is
    // what this assertion caught the first time it ran.
    // The MODULE names none — that is the template shape. A use of it carries the file, exactly
    // as an io/IN node carries its channel. The use is a file in `nodes/` now, so it
    // reaches the module through `extends` rather than by sitting beside it.
    file("modules/io/FILE/module.yaml", "io: file\n");
    file(
      "nodes/take.yaml",
      'extends: "@project/FILE"\nsource: "clips/original.wav"\n',
    );
    const g = loadGraph(dir);
    expect(g.modules.FILE?.source).toBeUndefined();
    expect(g.modules.take?.source).toBe("clips/original.wav");
  });

  it("is not somewhere a chain can route TO", () => {
    // The whole point of IO_SOURCES. `isSink` decides by ELIMINATION — every io module that
    // is not a source is a destination — so before the list existed this routing would have
    // been accepted in silence, wiring a chain INTO the thing meant to feed it.
    file("modules/io/FILE/module.yaml", "io: file\n");
    file(
      "modules/audio/amp/module.yaml",
      "plugin: {type: internal, name: Chorus}\n",
    );
    file("nodes/t.yaml", 'extends: "@studio/audio-track"\nclips: []\n');
    writeFileSync(
      join(dir, "chains.yaml"),
      "modules:\n  t: [ amp ]\n  amp: [ FILE ]\n",
      "utf8",
    );
    expect(loadGraph(dir).warnings).toContain(
      "chain 't': out 'FILE' is not a chain or io sink",
    );
  });
});
