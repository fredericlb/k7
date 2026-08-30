import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { moduleCatalogue } from "./moduleCatalogue";

// The builder's list IS what is editable: an unopenable entry is a module nobody can reach.

const here = dirname(fileURLToPath(import.meta.url));
const SONG = join(here, "..", "..", "..", "demos", "synth-demo.st0");

describe("the shared module catalogue", () => {
  let ws: string;
  let dir: string;
  const write = (rel: string, text: string) => {
    const p = join(ws, "_modules", rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  };

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "td-cat-"));
    dir = join(ws, "song");
    cpSync(SONG, dir, { recursive: true });
    write("config.yaml", "namespace: engine\n");
    // A module at the top of its type folder…
    write(
      "audio/reverb/module.yaml",
      "plugin:\n  type: internal\n  name: reverb\n",
    );
    // …one a category folder deeper, which is the other shape readModuleTree accepts…
    write(
      "audio/amp/nam/module.yaml",
      "plugin:\n  type: internal\n  name: nam\n",
    );
    // …and an io module with nodes beside it, as `module populate` writes them.
    write("io/IN/module.yaml", "io: in\n");
    write("io/IN/in-1.yaml", "channel: [1]\n");
    write("io/IN/in-2.yaml", "channel: [2]\n");
    const p = join(dir, "project.yaml");
    writeFileSync(
      p,
      readFileSync(p, "utf8").replace(
        "modules_from: []",
        "modules_from: [ ../_modules ]",
      ),
    );
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
      join(ws, "_modules", "audio", "amp", "nam", "module.yaml"),
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
    expect(refs).toContain("@engine/IN");
    expect(refs).toContain("@engine/OUT");
    // …and only the levels with NO folder behind them: `@engine`'s scan and `@studio`'s doc.
    expect(
      refs.every((r) => r.startsWith("@engine/") || r.startsWith("@studio/")),
    ).toBe(true);
    rmSync(alone, { recursive: true, force: true });
  });
});
