import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { moduleCatalogue } from "./moduleCatalogue";
import { writeDoc } from "./testSupport";

// The builder's list IS what is editable: an unopenable entry is a module nobody can reach.

const here = dirname(fileURLToPath(import.meta.url));
const SONG = join(here, "..", "..", "..", "demos", "synth-demo.k7");

describe("the shared module catalogue", () => {
  let ws: string;
  let dir: string;
  const write = (rel: string, value: Record<string, unknown>) =>
    writeDoc(join(ws, "_modules", rel), value);

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "td-cat-"));
    dir = join(ws, "song");
    cpSync(SONG, dir, { recursive: true });
    write("config.k7x", { namespace: "engine" });
    // A module at the top of its type folder…
    write("audio/reverb/module.k7x", {
      plugin: { type: "internal", name: "reverb" },
    });
    // …one a category folder deeper, which is the other shape readModuleTree accepts…
    write("audio/amp/nam/module.k7x", {
      plugin: { type: "internal", name: "nam" },
    });
    // …and an io module with nodes beside it, as `module populate` writes them.
    write("io/IN/module.k7x", { io: "in" });
    write("io/IN/in-1.k7x", { channel: [1] });
    write("io/IN/in-2.k7x", { channel: [2] });
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  const refs = () => moduleCatalogue(dir).map((m) => m.ref);
  const by = (ref: string) => moduleCatalogue(dir).find((m) => m.ref === ref);

  it("lists a module at either depth its catalogue allows", () => {
    expect(refs()).toEqual(
      expect.arrayContaining([
        "@workspace/audio/reverb",
        "@workspace/audio/amp/nam",
        "@workspace/io/IN",
      ]),
    );
  });

  it("lists the GENERICS only, counting the nodes instead", () => {
    // A node has no face of its own, so a builder aimed at one would edit nothing.
    expect(refs()).not.toContain("@workspace/io/IN:in-1");
    expect(by("@workspace/io/IN")?.nodes).toBe(2);
  });

  it("points at the file the builder opens", () => {
    expect(by("@workspace/audio/amp/nam")?.path).toBe(
      join(ws, "_modules", "audio", "amp", "nam", "module.k7x"),
    );
  });

  it("leaves the project's OWN modules out — they are not the catalogue", () => {
    // Every entry names a level the project INHERITS from, which `@project/` is not.
    expect(
      refs().every((r) => r.startsWith("@") && !r.startsWith("@project/")),
    ).toBe(true);
  });

  it("still offers the ENGINE's modules to a project with no shared library", () => {
    // In a workspace of its OWN, since the shared folders are found by location.
    const alone = mkdtempSync(join(tmpdir(), "td-cat-solo-"));
    const solo = join(alone, "song");
    cpSync(SONG, solo, { recursive: true });
    const refs = moduleCatalogue(solo).map((m) => m.ref);
    expect(refs).toContain("@meta/IN");
    expect(refs).toContain("@meta/OUT");
    // …and only the levels with NO folder behind them: `@engine`'s scan and `@meta`'s built-ins.
    expect(
      refs.every((r) => r.startsWith("@engine/") || r.startsWith("@meta/")),
    ).toBe(true);
    rmSync(alone, { recursive: true, force: true });
  });
});
