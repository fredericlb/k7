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

// The module builder's list. It replaced the graph as the way into a module's file, so what
// it lists IS what is editable — an entry it can't open, or one it lists twice, is a module
// nobody can reach or two that fight over one file.

const here = dirname(fileURLToPath(import.meta.url));
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "synth-demo.l8",
);

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
    // …and an io module with instances beside it, as `module populate` writes them.
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

  it("lists the GENERICS only, counting the instances instead", () => {
    // An instance has no face of its own — a `ui:` on one is ignored by the loader — so a
    // builder aimed at it would edit nothing. It is a number on its generic's row, not a row.
    expect(refs()).not.toContain("@workspace/io/IN:in-1");
    expect(by("@workspace/io/IN")?.instances).toBe(2);
  });

  it("points at the file the builder opens", () => {
    expect(by("@workspace/audio/amp/nam")?.path).toBe(
      join(ws, "_modules", "audio", "amp", "nam", "module.yaml"),
    );
  });

  it("leaves the project's OWN modules out — they are not the catalogue", () => {
    // Every entry names a level the project INHERITS from. `@project/` is the explicit spelling
    // of what the project owns, and a bare ref is the same thing written short — neither belongs
    // in a list of what to reach for.
    expect(
      refs().every((r) => r.startsWith("@") && !r.startsWith("@project/")),
    ).toBe(true);
  });

  it("still offers the ENGINE's modules to a project with no shared library", () => {
    // It used to answer nothing here, because the catalogue WAS the shared folder. The
    // engine's own modules are not files, so a project with no `_modules` beside it is not
    // a project with nothing to reach for — and IN and OUT are there even with no scan.
    //
    // In a workspace of its OWN: the shared folders are found by location now, so a project
    // sitting beside this fixture's `_modules` would see it whatever its header said.
    const alone = mkdtempSync(join(tmpdir(), "td-cat-solo-"));
    const solo = join(alone, "song");
    cpSync(SONG, solo, { recursive: true });
    const refs = moduleCatalogue(solo).map((m) => m.ref);
    expect(refs).toContain("@engine/IN");
    expect(refs).toContain("@engine/OUT");
    // …and nothing from a library, since there is none. `@engine` is the one level with no
    // folder behind it, which is exactly why it still answers here.
    expect(refs.every((r) => r.startsWith("@engine/"))).toBe(true);
    rmSync(alone, { recursive: true, force: true });
  });
});
