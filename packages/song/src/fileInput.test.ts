// An io module whose audio comes off DISK rather than off an interface (`io: file`). What is
// pinned here is that it is a SOURCE — the graph decides "sink" by elimination, so a role
// missing from IO_SOURCES becomes a silent sink and a chain routes into the thing meant to
// feed it. See docs/fileInput.md.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isIoSource,
  metaRef,
  moduleEmits,
} from "@studio/song-schema/moduleTypes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ioModules } from "./engineCatalogue";
import { isFileInputModule, isInputModule, loadGraph } from "./graph";
import { writeDoc } from "./testSupport";

let dir: string;

/** A k7x file at `rel` under the project, folders created. */
const file = (rel: string, value: Record<string, unknown>): void =>
  writeDoc(join(dir, rel), value);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-fileio-"));
  file("project.k7x", { project: { name: "song", tempo: 120 } });
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

  it("is built into the app, with no scan behind it", () => {
    const m = ioModules();
    expect(m[metaRef("FILE")]).toMatchObject({ io: "file", kind: "io" });
  });

  it("is NOT a live interface input", () => {
    // The narrower test gates channels, monitoring and trim, none of which a file has.
    const m = { kind: "io", io: "file" } as never;
    expect(isFileInputModule(m)).toBe(true);
    expect(isInputModule({} as never, m)).toBe(false);
  });

  it("carries the file it reads, and a chain may leave it unnamed", () => {
    // An io node carries its role directly — no separate module, no `extends` (docs/moduleTypes.md).
    file("nodes/take.k7x", { io: "file", source: "clips/original.wav" });
    const g = loadGraph(dir);
    expect(g.modules.take?.source).toBe("clips/original.wav");
  });

  it("is not somewhere a chain can route TO", () => {
    // `isSink` decides by ELIMINATION, so without IO_SOURCES a chain wires INTO its own feeder.
    file("modules/io/FILE/module.k7x", { io: "file" });
    file("modules/audio/amp/module.k7x", {
      plugin: { type: "internal", name: "Chorus" },
    });
    file("nodes/t.k7x", { extends: "@meta/track", events: [] });
    file("graph.k7x", { modules: { t: ["amp"], amp: ["FILE"] } });
    expect(loadGraph(dir).warnings).toContain(
      "chain 't': out 'FILE' is not a chain or io sink",
    );
  });
});
