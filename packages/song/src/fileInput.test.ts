// An io module whose audio comes off DISK rather than off an interface (`io: file`). What is
// pinned here is that it is a SOURCE — the graph decides "sink" by elimination, so a role
// missing from IO_SOURCES becomes a silent sink and a chain routes into the thing meant to
// feed it. See docs/fileInput.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  engineRef,
  isIoSource,
  moduleEmits,
} from "@studio/song-schema/moduleTypes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { engineModules } from "./engineCatalogue";
import { isFileInputModule, isInputModule, loadGraph } from "./graph";

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
    // Everything under io/ shares one type folder, so the ROLE decides what leaves the module.
    expect(moduleEmits("io", "file")).toBe("audio");
    expect(moduleEmits("io", "out")).toBeUndefined();
  });

  it("is offered by the engine, with no scan behind it", () => {
    const m = engineModules(join(dir, "nope.json"));
    expect(m[engineRef("FILE")]).toMatchObject({ io: "file", kind: "io" });
  });

  it("is NOT a live interface input", () => {
    // The narrower test gates channels, monitoring and trim, none of which a file has.
    const m = { kind: "io", io: "file" } as never;
    expect(isFileInputModule(m)).toBe(true);
    expect(isInputModule({} as never, m)).toBe(false);
  });

  it("carries the file it reads, and a chain may leave it unnamed", () => {
    // `source:` and not `file:`, which the loader overwrites with the module's FOLDER name.
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
    // `isSink` decides by ELIMINATION, so without IO_SOURCES a chain wires INTO its own feeder.
    file("modules/io/FILE/module.yaml", "io: file\n");
    file(
      "modules/audio/amp/module.yaml",
      "plugin: {type: internal, name: Chorus}\n",
    );
    file("nodes/t.yaml", 'extends: "@studio/track"\nevents: []\n');
    writeFileSync(
      join(dir, "graph.yaml"),
      "modules:\n  t: [ amp ]\n  amp: [ FILE ]\n",
      "utf8",
    );
    expect(loadGraph(dir).warnings).toContain(
      "chain 't': out 'FILE' is not a chain or io sink",
    );
  });
});
