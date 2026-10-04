// `node engine` — what the graph's engine dropdown runs — and `node param` on a module with engines,
// which must land in THAT engine's params. Through the dispatcher and asserting the FILE, for the
// reason bypass.test.ts gives. See packages/song/docs/engines.md.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setModuleAsset, setModuleParam } from "@studio/song-edit/projectEdit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { runCommand } from "./commandSpec";

let root: string;
let dir: string;
const logs: string[] = [];
let reloaded = 0;

/** A lane through one compressor node, the compressor holding two engines in `@workspace`. */
function song(node: string): void {
  root = mkdtempSync(join(tmpdir(), "td-engine-"));
  dir = join(root, "song.st0");
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "graph.yaml"),
    "modules:\n  gtr: [ comp ]\n  comp: [ OUT ]\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "nodes", "gtr.yaml"),
    'extends: "@meta/track"\nevents: []\n',
    "utf8",
  );
  writeFileSync(join(dir, "nodes", "comp.yaml"), node, "utf8");
  const mod = join(root, "_modules", "audio", "compressor");
  for (const [at, body] of [
    ["", "engine: tracktion\n"],
    ["engines/tracktion", "plugin: { type: internal, name: compressor }\n"],
    [
      "engines/vari-mu",
      "plugin: { type: internal, name: airwindows_varimu }\n",
    ],
  ]) {
    mkdirSync(join(mod, at), { recursive: true });
    writeFileSync(join(mod, at, "module.yaml"), body, "utf8");
  }
}

const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [], groups: [], masterPlugins: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {
      reloaded++;
    },
  }) as never;

const node = () => parse(readFileSync(join(dir, "nodes", "comp.yaml"), "utf8"));

beforeEach(() => {
  logs.length = 0;
  reloaded = 0;
  song('extends: "@workspace/audio/compressor"\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("node engine", () => {
  it("writes the engine on the node and reloads", async () => {
    await runCommand("node engine comp vari-mu", host(), "cli");
    expect(node().engine).toBe("vari-mu");
    expect(reloaded).toBe(1);
  });

  it("lists the engines, the one on in brackets, when given no name", async () => {
    await runCommand("node engine comp", host(), "cli");
    expect(logs).toEqual(["comp: [tracktion]  vari-mu"]);
  });

  it("refuses an engine the module has not got, and writes nothing", async () => {
    await runCommand("node engine comp nope", host(), "cli");
    expect(logs[0]).toMatch(/no engine 'nope'.*tracktion, vari-mu/);
    expect(node().engine).toBeUndefined();
  });

  it("writes on the ALTERNATIVE that is on", async () => {
    rmSync(root, { recursive: true, force: true });
    song(
      'extends: "@workspace/audio/compressor"\nalternative: b\nalternatives:\n  - name: b\n',
    );
    await runCommand("node engine comp vari-mu", host(), "cli");
    expect(node().engine).toBeUndefined();
    expect(node().alternatives[0].engine).toBe("vari-mu");
  });
});

describe("a knob on a module with engines", () => {
  it("lands under the engine that is on, so switching back finds it", async () => {
    setModuleParam(dir, "comp", "Ratio", 0.2);
    await runCommand("node engine comp vari-mu", host(), "cli");
    setModuleParam(dir, "comp", "Intensty", 0.7);
    expect(node().engines).toEqual({
      tracktion: { params: { Ratio: 0.2 } },
      "vari-mu": { params: { Intensty: 0.7 } },
    });
    expect(node().params).toBeUndefined();
  });
});

describe("a file param on a module with engines", () => {
  it("lands under the engine that is on, like a knob, and clears from there", async () => {
    await runCommand("node engine comp vari-mu", host(), "cli");
    setModuleAsset(dir, "comp", "model", "twin.nam");
    expect(node().engines).toEqual({
      "vari-mu": { params: { model: "twin.nam" } },
    });
    expect(node().params).toBeUndefined();
    setModuleAsset(dir, "comp", "model", null);
    expect(node().engines["vari-mu"].params).toEqual({});
  });
});
