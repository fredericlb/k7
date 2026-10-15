// PICTURE in a chain project (docs/chainFiles.md): a picture lane is a `video_track` item heading a
// chain of its own, a shape starts the chain of the lane it draws on, and a fade's STRETCH is a
// subchain of its lane's chain. The migration carries all three over, the segments read back the
// same graph, and the sound the engine is handed does not change by a byte.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectNodes } from "@studio/song-schema/yaml/graphFile";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editChainGraph } from "./chainGraphEdit";
import { readChainProject, readLayout, toSegments } from "./chainProject";
import { migrateToChainFiles } from "./chainsMigrateFiles";
import { loadGraph, validate } from "./graph";
import { loadProject } from "./project";
import { wsRead } from "./yaml/workspaceFile";

let root: string;
let dir: string;
const write = (rel: string, text: string) => {
  const abs = join(dir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, text);
};
const module = (rel: string, text: string) => {
  const abs = join(root, "_modules", rel);
  mkdirSync(abs, { recursive: true });
  writeFileSync(join(abs, "module.yaml"), text);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "chain-picture-"));
  dir = join(root, "film.k7");
  for (const s of ["glow", "iris"]) {
    module(`shaders/${s}`, "type: shader\nshader: p\n");
    mkdirSync(join(root, "_modules", "shaders", s, "shaders", "p"), {
      recursive: true,
    });
    for (const f of ["vertex.glsl", "fragment.glsl"])
      writeFileSync(
        join(root, "_modules", "shaders", s, "shaders", "p", f),
        "",
      );
  }
  module(
    "shapes/box",
    "type: shape\nshape: square\nparams: { w: 10, h: 10 }\n",
  );
  write(
    "project.yaml",
    "project:\n  name: film\n  tempo: 120\n  viewport: [640, 360, 30]\n  layers: [main, boxes]\n",
  );
  write("clips/a.yaml", "source: a.mp4\n");
  write("clips/a.mp4", "");
  write(
    "video_tracks/main.yaml",
    "events:\n  - { ref: a, start: 0, length: 4 }\n  - { ref: a, start: 3, length: 4, fade_in: { over: 1, chain: iris } }\n",
  );
  write("video_tracks/boxes.yaml", "events: []\n");
  write("nodes/glow.yaml", 'extends: "@workspace/shaders/glow"\n');
  write("nodes/iris.yaml", 'extends: "@workspace/shaders/iris"\n');
  // The shape is named by its REF, with no node file: the graph may say a module outright.
  write(
    "graph.yaml",
    'modules:\n  main: [ glow ]\n  glow: [ RENDER ]\n  iris: [ main ]\n  "@workspace/shapes/box": [ boxes ]\n  RENDER: [ VIDEO_OUT ]\n',
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const chainText = (name: string) => wsRead(join(dir, "chains", `${name}.yaml`));

describe("migrating a project with picture", () => {
  it("puts a picture lane at the head of a `start: true` chain of its own", () => {
    migrateToChainFiles(dir);
    const main = readChainProject(dir).chains.main;
    expect(main.start).toBe(true);
    expect(main.steps[0]).toMatchObject({ video_track: "main" });
  });

  it("makes the stretch a SUBCHAIN of the lane's chain, with no way out of its own", () => {
    migrateToChainFiles(dir);
    const main = readChainProject(dir).chains.main;
    expect(main.subchains).toEqual([
      {
        id: "iris",
        steps: [
          expect.objectContaining({ extends: "@workspace/shaders/iris" }),
        ],
      },
    ]);
  });

  it("renames the fade to the subchain it now names", () => {
    write(
      "video_tracks/main.yaml",
      "events:\n  - { ref: a, start: 0, length: 4 }\n  - { ref: a, start: 3, length: 4, fade_in: { over: 1, chain: iris } }\n",
    );
    // A head node named otherwise than its leaf, so the rename is visible.
    write("nodes/opening.yaml", 'extends: "@workspace/shaders/iris"\n');
    write(
      "graph.yaml",
      "modules:\n  main: [ glow ]\n  glow: [ RENDER ]\n  opening: [ main ]\n  RENDER: [ VIDEO_OUT ]\n",
    );
    write(
      "video_tracks/main.yaml",
      "events:\n  - { ref: a, start: 3, length: 4, fade_in: { over: 1, chain: opening } }\n",
    );
    rmSync(join(dir, "nodes", "iris.yaml"));
    migrateToChainFiles(dir);
    expect(wsRead(join(dir, "video_tracks", "main.yaml"))).toContain(
      "chain: iris",
    );
  });

  it("starts a SHAPE's chain, the lane it draws on following it", () => {
    migrateToChainFiles(dir);
    const boxes = readChainProject(dir).chains.boxes;
    expect(boxes.start).toBe(true);
    expect(boxes.steps[0]).toMatchObject({ extends: "@workspace/shapes/box" });
    expect(boxes.steps[1]).toMatchObject({ video_track: "boxes" });
  });

  it("reads back the same graph, the stretch landing on its lane", () => {
    const before = loadGraph(dir);
    migrateToChainFiles(dir);
    const after = loadGraph(dir);
    expect(validate(after)).toEqual([]);
    const iris = readChainProject(dir).chains.main.subchains?.[0].steps[0] as {
      id: string;
    };
    expect(toSegments(readChainProject(dir)).graph.modules?.[iris.id]).toEqual([
      "main",
    ]);
    // Same runs as before, keyed by id where a node lost its name.
    const shape = (g: typeof before) =>
      Object.values(g.chains)
        .map(
          (c) =>
            `${c.from ?? ""}>${c.use.length}>${c.out.map((o) => o.to).join(",")}`,
        )
        .sort();
    expect(shape(after).length).toBe(shape(before).length);
  });

  it("hands the engine the very same document", () => {
    const strip = (d: unknown) => JSON.stringify(d).split(dir).join("DIR");
    const before = strip(loadProject(dir));
    migrateToChainFiles(dir);
    expect(strip(loadProject(dir))).toBe(before);
  });
});

describe("a graph edit on a chain project with picture", () => {
  it("keeps the stretch where it was, under its id", () => {
    migrateToChainFiles(dir);
    const glowId = Object.values(readChainProject(dir).nodes).find(
      (n) =>
        (n.value as { extends?: string }).extends === "@workspace/shaders/glow",
    )?.name as string;
    // An unrelated edit: the whole graph is rewritten, the stretch included.
    editChainGraph(dir, (t) => connectNodes(t, glowId, "OUT"));
    expect(chainText("main")).toContain("- id: iris");
    expect(readChainProject(dir).chains.main.subchains?.[0].id).toBe("iris");
    expect(readLayout(dir)).toEqual({});
  });
});
