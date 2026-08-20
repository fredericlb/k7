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
import { loadGraph } from "./graph";
import { projectHints } from "./hints";
import { compileNodeProject } from "./nodeProject";
import { insertChainStepAfter, replaceChainStep } from "./testSupport";

// A chain step used to name only a module of the project's OWN modules/ folder. An
// inherited one — the workspace's shared _modules, reachable through
// project.modules_from — could be `extends`ed but never used directly, so borrowing a
// reverb meant writing a one-line local module that extended it and nothing else.
//
// These pin that a step may name it by its ref instead: it resolves (merged through
// `extends`, like a local module), it compiles into the track, and it is offered as a
// completion. The ref is quoted because YAML reserves a leading `@`.

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "synth-demo.st0",
);
const REF = "@workspace/audio/shared-delay";

describe("a chain step naming an inherited module by ref", () => {
  let ws: string;
  let dir: string;
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "td-nsstep-"));
    dir = join(ws, "song");
    cpSync(SONG, dir, { recursive: true });
    // The workspace's shared catalogue: a namespace, and one module in it.
    mkdirSync(join(ws, "_modules", "audio", "shared-delay"), {
      recursive: true,
    });
    writeFileSync(
      join(ws, "_modules", "audio", "shared-delay", "module.yaml"),
      "plugin:\n  type: internal\n  name: delay\n",
    );
    // …and a shared SINK, for the other position a module name is written in.
    mkdirSync(join(ws, "_modules", "io", "desk"), { recursive: true });
    writeFileSync(
      join(ws, "_modules", "io", "desk", "module.yaml"),
      "io: out\n",
    );
    // Point the project at it, keeping the rest of project.yaml as the fixture wrote it.
    const p = join(dir, "project.yaml");
    writeFileSync(
      p,
      readFileSync(p, "utf8").replace(
        "modules_from: []",
        "modules_from: [ ../_modules ]",
      ),
    );
    insertChainStepAfter(dir, "lead", { module: REF });
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("resolves, rather than being reported as a dangling name", () => {
    const g = loadGraph(dir);
    expect(g.warnings.filter((w) => w.includes(REF))).toEqual([]);
    expect(g.modules[REF]).toMatchObject({ plugin: { name: "delay" } });
  });

  it("compiles into the track, like a local module would", () => {
    const melody = compileNodeProject(dir).tracks.find(
      (t) => t.id === "melody",
    );
    expect(melody!.plugins.some((p) => p.id.endsWith(`:${REF}`))).toBe(true);
  });

  it("is offered as a completion, alongside the project's own modules", () => {
    const h = projectHints(dir);
    expect(h.modules).toContain(REF);
    expect(h.modules).toContain("lead"); // the local names are still there
    // io is offered too — both roles are chain nodes now: an "out" ends a chain, an
    // "in" feeds one. (An inherited NODE is nameable as well, which is the whole
    // point for io/IN: `module populate` files one per physical input.)
    expect(h.modules).toContain("@workspace/io/desk");
    expect(h.ioSinks).toContain("@workspace/io/desk");
  });

  // The chain's LAST node is its sink, parsed out of the steps — a different lookup, so
  // it needs its own proof that a ref reaches it.
  it("works in the sink position too, not only as a step", () => {
    replaceChainStep(dir, "OUT", { module: "@workspace/io/desk" });
    const g = loadGraph(dir);
    expect(g.warnings.filter((w) => w.includes("desk"))).toEqual([]);
    expect(Object.values(g.chains)[0].out[0].to).toBe("@workspace/io/desk");
  });
});

// The `/` vs `:` slip: a node sits BESIDE a module.yaml, so its ref is the module's
// with `:node` — but on disk it reads like a folder, and the two spellings look the
// same. "is not a module" is true and useless there; the fix is one character.
describe("a ref that spells a node with a slash", () => {
  it("is told which character to change", () => {
    const ws = mkdtempSync(join(tmpdir(), "td-slash-"));
    const dir = join(ws, "song");
    cpSync(SONG, dir, { recursive: true });
    mkdirSync(join(ws, "_modules", "io", "IN"), { recursive: true });
    writeFileSync(join(ws, "_modules", "io", "IN", "module.yaml"), "io: in\n");
    writeFileSync(
      join(ws, "_modules", "io", "IN", "in-2.yaml"),
      "channel: [2]\n",
    );
    const p = join(dir, "project.yaml");
    writeFileSync(
      p,
      readFileSync(p, "utf8").replace(
        "modules_from: []",
        "modules_from: [ ../_modules ]",
      ),
    );
    const c = join(dir, "graph.yaml");
    writeFileSync(
      c,
      `${readFileSync(c, "utf8")}  "@workspace/io/IN/in-2": [ melody ]\n`,
    );
    const w = loadGraph(dir).warnings;
    expect(
      w.some((x) => x.includes("did you mean '@workspace/io/IN:in-2'")),
    ).toBe(true);
    rmSync(ws, { recursive: true, force: true });
  });
});
