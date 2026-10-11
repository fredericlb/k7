// A library's SOUND files: listed as `@<library>/<path>`, resolved back to the file, and carried by a
// module's `ir` param all the way into the compiled document the engine is handed (docs/libraryFiles.md).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { libraryFile, libraryFiles } from "./libraryFiles";
import { loadModuleRefs, loadModules } from "./loader";
import { resolveModule } from "./moduleResolve";
import { loadProject } from "./project";
import { librariesFixture } from "./testSupport";

let root: string;
let lib: string;
const touch = (path: string) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "");
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-libfiles-"));
  lib = librariesFixture(root, "st0");
  touch(join(lib, "irs", "fender deluxe", "big.wav"));
  touch(join(lib, "irs", "fender deluxe", "notes.txt"));
  touch(join(lib, "samples", "kicks", "808.wav"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.STUDIO_HOME;
});

describe("libraryFiles", () => {
  it("lists a family's SOUND files as @<library>/<path>, and nothing else", () => {
    expect(libraryFiles("irs")).toEqual(["@st0/fender deluxe/big.wav"]);
    expect(libraryFiles("samples")).toEqual(["@st0/kicks/808.wav"]);
  });

  it("resolves a ref back to the file, in that family's folder only", () => {
    expect(libraryFile("irs", "@st0/fender deluxe/big.wav")).toBe(
      join(lib, "irs", "fender deluxe", "big.wav"),
    );
    // The same path under the OTHER family is not this file.
    expect(libraryFile("samples", "@st0/fender deluxe/big.wav")).toBe(
      join(lib, "samples", "fender deluxe", "big.wav"),
    );
  });

  it("refuses a ref that climbs out of the folder, or names no library", () => {
    expect(libraryFile("irs", "@st0/../modules/x.yaml")).toBeUndefined();
    expect(libraryFile("irs", "@nope/big.wav")).toBeUndefined();
    expect(libraryFile("irs", "fender deluxe/big.wav")).toBeUndefined();
  });
});

describe("a module's `ir` param", () => {
  const song = () => {
    const p = join(root, "song.st0");
    mkdirSync(join(p, "nodes"), { recursive: true });
    writeFileSync(join(p, "project.yaml"), 'project:\n  name: "song"\n');
    mkdirSync(join(root, "_modules", "audio", "amp"), { recursive: true });
    writeFileSync(
      join(root, "_modules", "audio", "amp", "module.yaml"),
      "plugin: { type: internal, name: Neural Amp Modeler }\n",
    );
    writeFileSync(
      join(p, "nodes", "gtr.yaml"),
      'extends: "@meta/track"\nevents: []\n',
    );
    writeFileSync(
      join(p, "nodes", "amp.yaml"),
      'extends: "@workspace/audio/amp"\nparams:\n  ir: "@st0/fender deluxe/big.wav"\n',
    );
    writeFileSync(
      join(p, "graph.yaml"),
      "modules:\n  gtr: [ amp ]\n  amp: [ OUT ]\n",
    );
    return p;
  };

  it("resolves to the library's file, keeping the name it was written with", () => {
    const p = song();
    const amp = resolveModule(loadModules(p).amp, loadModuleRefs(p));
    expect(amp.ir).toBe(join(lib, "irs", "fender deluxe", "big.wav"));
    expect(amp.assets?.ir).toBe("@st0/fender deluxe/big.wav");
  });

  it("reaches the engine's document as the plugin's irFile", () => {
    const doc = loadProject(song());
    const plugin = doc.tracks
      .flatMap((t) => t.plugins)
      .find((pl) => pl.id.endsWith(":amp"));
    expect(plugin?.irFile).toBe(join(lib, "irs", "fender deluxe", "big.wav"));
  });
});

describe("a module's `model` param, from a library's models/", () => {
  const song = (model: string) => {
    const p = join(root, "song.st0");
    mkdirSync(join(p, "nodes"), { recursive: true });
    writeFileSync(join(p, "project.yaml"), 'project:\n  name: "song"\n');
    touch(join(root, "_modules", "audio", "amp", "assets", "own.nam"));
    writeFileSync(
      join(root, "_modules", "audio", "amp", "module.yaml"),
      "plugin: { type: internal, name: Neural Amp Modeler }\n",
    );
    writeFileSync(
      join(p, "nodes", "gtr.yaml"),
      'extends: "@meta/track"\nevents: []\n',
    );
    writeFileSync(
      join(p, "nodes", "amp.yaml"),
      `extends: "@workspace/audio/amp"\nparams:\n  model: "${model}"\n`,
    );
    writeFileSync(
      join(p, "graph.yaml"),
      "modules:\n  gtr: [ amp ]\n  amp: [ OUT ]\n",
    );
    return p;
  };
  const engineFile = (p: string) =>
    loadProject(p)
      .tracks.flatMap((t) => t.plugins)
      .find((pl) => pl.id.endsWith(":amp"))?.namFile;

  beforeEach(() => {
    touch(join(lib, "models", "proteus", "ts9.json"));
    touch(join(lib, "models", "proteus", "README.md"));
    touch(join(lib, "models", "amp.nam"));
  });

  it("lists a library's models — .nam and .json, nothing else", () => {
    expect(libraryFiles("models")).toEqual([
      "@st0/amp.nam",
      "@st0/proteus/ts9.json",
    ]);
  });

  it("reaches the engine as the library's file when the ref says @<library>/", () => {
    expect(engineFile(song("@st0/proteus/ts9.json"))).toBe(
      join(lib, "models", "proteus", "ts9.json"),
    );
  });

  it("still reaches the module's own assets when it does not", () => {
    expect(engineFile(song("own.nam"))).toBe(
      join(root, "_modules", "audio", "amp", "assets", "own.nam"),
    );
  });
});

describe("a rack tap's `sample`", () => {
  it("reaches the engine as the sound's file, the kit written on the NODE", () => {
    const p = join(root, "kit.st0");
    mkdirSync(join(p, "nodes"), { recursive: true });
    writeFileSync(join(p, "project.yaml"), 'project:\n  name: "kit"\n');
    mkdirSync(join(root, "_modules", "instruments", "drums"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "_modules", "instruments", "drums", "module.yaml"),
      "type: rack\n",
    );
    writeFileSync(
      join(p, "nodes", "beat.yaml"),
      'extends: "@meta/track"\nevents: []\n',
    );
    writeFileSync(
      join(p, "nodes", "kit.yaml"),
      'extends: "@workspace/instruments/drums"\ntype: rack\nrack:\n  symbols:\n' +
        '    BD: { note: 36, sample: "@st0/kicks/808.wav" }\n',
    );
    writeFileSync(
      join(p, "graph.yaml"),
      "modules:\n  beat: [ kit ]\n  kit: [ OUT ]\n",
    );
    const rack = loadProject(p)
      .tracks.flatMap((t) => t.plugins)
      .find((pl) => pl.rack?.length)?.rack;
    expect(rack).toEqual([
      expect.objectContaining({
        symbol: "BD",
        note: 36,
        clip: join(lib, "samples", "kicks", "808.wav"),
      }),
    ]);
  });
});

describe("a tap's sample inside an ALTERNATIVE", () => {
  it("still reaches the engine when that set is the one selected", () => {
    const p = join(root, "demo.st0");
    touch(join(p, "samples", "kick.wav"));
    touch(join(p, "samples", "snare.wav"));
    mkdirSync(join(p, "nodes"), { recursive: true });
    writeFileSync(join(p, "project.yaml"), 'project:\n  name: "demo"\n');
    mkdirSync(join(root, "_modules", "instruments", "drums"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "_modules", "instruments", "drums", "module.yaml"),
      "type: rack\n",
    );
    writeFileSync(
      join(p, "nodes", "beat.yaml"),
      'extends: "@meta/track"\nevents: []\n',
    );
    writeFileSync(
      join(p, "nodes", "kit.yaml"),
      'extends: "@workspace/instruments/drums"\ntype: rack\nrack:\n  symbols:\n    BD: { note: 36, sample: "@project/kick.wav" }\n' +
        'alternatives:\n  - rack:\n      symbols:\n        BD: { note: 36, sample: "@project/snare.wav" }\nalternative: "2"\n',
    );
    writeFileSync(
      join(p, "graph.yaml"),
      "modules:\n  beat: [ kit ]\n  kit: [ OUT ]\n",
    );
    const rack = loadProject(p)
      .tracks.flatMap((t) => t.plugins)
      .find((pl) => pl.rack?.length)?.rack;
    expect(rack?.[0]).toMatchObject({
      symbol: "BD",
      clip: join(p, "samples", "snare.wav"),
    });
  });
});

describe("a PROJECT's own samples, as @project/…", () => {
  it("lists them before the libraries', and resolves them in that project only", () => {
    const p = join(root, "demo.st0");
    touch(join(p, "samples", "kick.wav"));
    expect(libraryFiles("samples", p)).toEqual([
      "@project/kick.wav",
      "@st0/kicks/808.wav",
    ]);
    expect(libraryFile("samples", "@project/kick.wav", p)).toBe(
      join(p, "samples", "kick.wav"),
    );
    // With no project to be read for, `@project/` names nothing rather than guessing one.
    expect(libraryFile("samples", "@project/kick.wav")).toBeUndefined();
  });

  it("reaches the engine from a tap on a node", () => {
    const p = join(root, "demo.st0");
    touch(join(p, "samples", "kick.wav"));
    mkdirSync(join(p, "nodes"), { recursive: true });
    writeFileSync(join(p, "project.yaml"), 'project:\n  name: "demo"\n');
    mkdirSync(join(root, "_modules", "instruments", "drums"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "_modules", "instruments", "drums", "module.yaml"),
      "type: rack\n",
    );
    writeFileSync(
      join(p, "nodes", "beat.yaml"),
      'extends: "@meta/track"\nevents: []\n',
    );
    writeFileSync(
      join(p, "nodes", "kit.yaml"),
      'extends: "@workspace/instruments/drums"\ntype: rack\nrack:\n  symbols:\n    BD: { note: 36, sample: "@project/kick.wav" }\n',
    );
    writeFileSync(
      join(p, "graph.yaml"),
      "modules:\n  beat: [ kit ]\n  kit: [ OUT ]\n",
    );
    const rack = loadProject(p)
      .tracks.flatMap((t) => t.plugins)
      .find((pl) => pl.rack?.length)?.rack;
    expect(rack?.[0]).toMatchObject({
      symbol: "BD",
      clip: join(p, "samples", "kick.wav"),
    });
  });
});
