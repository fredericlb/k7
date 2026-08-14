import type { MediatekEntry } from "@studio/mediatek/types";
import { describe, expect, it } from "vitest";
import { libraryModuleRef, libraryTree } from "./libraryTree";

const mod = (path: string, files: string[]): MediatekEntry => ({
  family: "modules",
  id: path,
  name: path.split("/").pop() ?? path,
  path,
  kind: path.split("/")[1] ?? "",
  mtime: 0,
  files,
});

describe("libraryTree", () => {
  it("puts one namespace row above the catalogue", () => {
    const [root] = libraryTree([mod("modules/audio/reverb", ["module.yaml"])]);
    expect(root.name).toBe("@mediatek");
    expect(root.dir).toBe(true);
    expect(root.children?.map((n) => n.name)).toEqual(["audio"]);
  });

  it("keeps library-relative paths, so the store can read them", () => {
    const [root] = libraryTree([mod("modules/audio/reverb", ["module.yaml"])]);
    const type = root.children?.[0];
    const module = type?.children?.[0];
    expect(type?.path).toBe("modules/audio");
    expect(module?.path).toBe("modules/audio/reverb");
    expect(module?.children?.[0].path).toBe("modules/audio/reverb/module.yaml");
  });

  it("files a categorised module one folder deeper, as the ref does", () => {
    const [root] = libraryTree([
      mod("modules/audio/delay/tape-delay", ["module.yaml"]),
    ]);
    const delay = root.children?.[0].children?.[0];
    expect(delay?.name).toBe("delay");
    expect(delay?.children?.map((n) => n.name)).toEqual(["tape-delay"]);
  });

  it("draws the files the module actually holds and no others", () => {
    const [root] = libraryTree([
      mod("modules/audio/reverb", ["module.yaml", "ui.yaml", "hall.yaml"]),
    ]);
    const module = root.children?.[0].children?.[0];
    expect(module?.children?.map((n) => n.name)).toEqual([
      "hall.yaml",
      "module.yaml",
      "ui.yaml",
    ]);
    // A folder holding module.yaml is what l8's FileTree folds into one row.
    expect(module?.children?.some((n) => n.name === "module.yaml")).toBe(true);
  });

  it("shares a category folder between two modules", () => {
    const [root] = libraryTree([
      mod("modules/audio/delay/tape-delay", ["module.yaml"]),
      mod("modules/audio/delay/ping-pong", ["module.yaml"]),
    ]);
    const delay = root.children?.[0].children?.[0];
    expect(delay?.children?.map((n) => n.name)).toEqual([
      "ping-pong",
      "tape-delay",
    ]);
  });

  it("sorts folders before modules, then by name", () => {
    const [root] = libraryTree([
      mod("modules/audio/reverb", ["module.yaml"]),
      mod("modules/audio/delay/tape-delay", ["module.yaml"]),
    ]);
    // `reverb` is a module — a folder in the tree too — so the two sort by name alone.
    expect(root.children?.[0].children?.map((n) => n.name)).toEqual([
      "delay",
      "reverb",
    ]);
  });

  it("ignores an entry with nothing below the family", () => {
    expect(libraryTree([mod("modules", [])])[0].children).toEqual([]);
  });
});

describe("libraryModuleRef", () => {
  it("names the module the way a chain does", () => {
    expect(libraryModuleRef("modules/audio/reverb/module.yaml")).toBe(
      "@mediatek/audio/reverb",
    );
  });

  it("keeps the category segment", () => {
    expect(libraryModuleRef("modules/audio/delay/tape-delay/ui.yaml")).toBe(
      "@mediatek/audio/delay/tape-delay",
    );
  });

  it("drops the last segment whatever it is spelt like", () => {
    // A module may be called `tape.delay`; the file is dropped by POSITION, never by looks.
    expect(libraryModuleRef("modules/audio/tape.delay/module.yaml")).toBe(
      "@mediatek/audio/tape.delay",
    );
  });

  it("answers nothing for a path outside the modules family", () => {
    expect(libraryModuleRef("chains/blindtest/chains.yaml")).toBeNull();
  });

  it("answers nothing for a file that is not inside a module folder", () => {
    expect(libraryModuleRef("modules/config.yaml")).toBeNull();
  });
});
