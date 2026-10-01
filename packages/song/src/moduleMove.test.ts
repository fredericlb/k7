// Moving a library module: where it may go, and the refs that follow it. Pinned here: a module stays
// in its library and its type, at most one category deep; an engine never moves alone; and the
// rewrite repoints the ref in every spelling a file uses without touching a ref it merely prefixes.
// See docs/moduleMove.md.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planModuleMove, repointRefs } from "./moduleMove";

let root: string;
let lib: { name: string; root: string };
const mod = (...p: string[]) => join(lib.root, "modules", ...p);
const write = (file: string, text: string) => {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text, "utf8");
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-move-"));
  lib = { name: "st0", root: join(root, "st0") };
  write(join(mod("audio", "delay", "echo"), "module.yaml"), "label: Echo\n");
  write(
    join(mod("audio", "delay", "echo", "engines", "x"), "module.yaml"),
    "label: X\n",
  );
  mkdirSync(mod("audio", "time"), { recursive: true });
  mkdirSync(mod("instruments"), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("where a module may go", () => {
  it("moves within its type, and names the two refs", () => {
    expect(
      planModuleMove(lib, mod("audio", "delay", "echo"), mod("audio", "time")),
    ).toEqual({
      from: "@st0/audio/delay/echo",
      to: "@st0/audio/time/echo",
      dest: mod("audio", "time", "echo"),
    });
  });

  it("may land in the type folder itself", () => {
    expect(
      planModuleMove(lib, mod("audio", "delay", "echo"), mod("audio")).to,
    ).toBe("@st0/audio/echo");
  });

  it.each([
    ["another type", () => mod("instruments"), /stays in its type/],
    [
      "a category's category",
      () => mod("audio", "time", "deep"),
      /one category below/,
    ],
    [
      "inside a module",
      () => {
        write(join(mod("audio", "verb"), "module.yaml"), "label: Verb\n");
        return mod("audio", "verb");
      },
      /not inside another module/,
    ],
    ["where it already is", () => mod("audio", "delay"), /already there/],
  ])("refuses %s", (_, dest, why) => {
    mkdirSync(dest(), { recursive: true });
    expect(() =>
      planModuleMove(lib, mod("audio", "delay", "echo"), dest()),
    ).toThrow(why);
  });

  it("never moves an engine on its own", () => {
    expect(() =>
      planModuleMove(
        lib,
        mod("audio", "delay", "echo", "engines", "x"),
        mod("audio", "time"),
      ),
    ).toThrow(/engine moves with its module/);
  });

  it("refuses to clobber a module of the same name", () => {
    write(join(mod("audio", "time", "echo"), "module.yaml"), "label: Other\n");
    expect(() =>
      planModuleMove(lib, mod("audio", "delay", "echo"), mod("audio", "time")),
    ).toThrow(/already a echo/);
  });
});

describe("repointing the refs", () => {
  it("rewrites every spelling, and leaves a ref it only prefixes alone", () => {
    const song = join(root, "song", "nodes", "a.yaml");
    write(
      song,
      [
        'extends: "@st0/audio/delay/echo"',
        "alternatives:",
        "  - extends: @st0/audio/delay/echo",
        '  - extends: "@st0/audio/delay/echo-2"',
        "",
      ].join("\n"),
    );
    const graph = join(root, "song", "graph.yaml");
    write(
      graph,
      "modules:\n  gtr: [ @st0/audio/delay/echo:slap, @st0/audio/delay/echo#b ]\n",
    );
    const changed = repointRefs(
      [root],
      "@st0/audio/delay/echo",
      "@st0/audio/time/echo",
    );
    expect(changed.sort()).toEqual([graph, song].sort());
    expect(readFileSync(song, "utf8")).toBe(
      [
        'extends: "@st0/audio/time/echo"',
        "alternatives:",
        "  - extends: @st0/audio/time/echo",
        '  - extends: "@st0/audio/delay/echo-2"',
        "",
      ].join("\n"),
    );
    expect(readFileSync(graph, "utf8")).toContain(
      "[ @st0/audio/time/echo:slap, @st0/audio/time/echo#b ]",
    );
  });

  it("never walks a song's history or the recycle bin", () => {
    const old = join(root, "song", "_history", "x.yaml");
    write(old, 'extends: "@st0/audio/delay/echo"\n');
    expect(
      repointRefs([root], "@st0/audio/delay/echo", "@st0/audio/time/echo"),
    ).toEqual([]);
  });
});
