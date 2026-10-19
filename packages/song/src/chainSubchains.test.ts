// SUBCHAINS (docs/chainFiles.md): a chain's own chains, linked into only from inside its file and
// linking out only to its other subchains or a built-in end. They compile like any chain, and a graph
// edit writes them back into their parent — or lifts one out when the edit breaks its scope.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatChain, parseChain } from "@studio/song-schema/yaml/chainFile";
import {
  connectNodes,
  insertBetween,
  setModuleEnabled,
} from "@studio/song-schema/yaml/graphFile";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editChainGraph } from "./chainGraphEdit";
import { spliceChainItem } from "./chainItemEdit";
import { readChainProject, readLayout, toSegments } from "./chainProject";
import { placeOf } from "./nodePlace";
import { wsData } from "./yaml/workspaceDoc";

const AMP = '"@k7-core/audio/amp"';
const GTR = [
  "start(true)",
  "steps([",
  '  id("lane-gtr").track("gtr"),',
  `  id("amp-1").extends(${AMP}),`,
  '  to([chain("wet").level(0.5), chain("MIX").level(1)]),',
  "])",
  "subchains([",
  '  id("wet").steps([',
  `    id("verb-1").extends(${AMP}),`,
  "    // the room",
  `    id("eq-1").extends(${AMP}),`,
  '    to([chain("MIX")]),',
  "  ]),",
  "])",
  "",
].join("\n");

const issuesOf = (text: string) =>
  parseChain(text).issues.map((i) => i.message);

describe("a chain file's subchains", () => {
  it("parse, and survive a rewrite with their comments", () => {
    const parsed = parseChain(GTR);
    expect(parsed.issues).toEqual([]);
    expect(parsed.value?.subchains?.[0].id).toBe("wet");
    const again = formatChain(parsed.value as never, GTR);
    expect(again).toContain("// the room");
    expect(parseChain(again).value).toEqual(parsed.value);
  });

  it("link out only to a sibling or a built-in end", () => {
    const text = GTR.replace(
      '    to([chain("MIX")]),',
      '    to([chain("bus")]),',
    );
    expect(issuesOf(text).join(" ")).toMatch(
      /links only to its parent's subchains/,
    );
  });

  it("hold no lane, and take no sink's name nor a sibling's", () => {
    const lane = GTR.replace(
      `    id("eq-1").extends(${AMP}),`,
      '    id("l2").track("bass"),',
    );
    expect(issuesOf(lane).join(" ")).toMatch(/subchain cannot hold one/);
    const sink = GTR.replace(
      '  id("wet").steps([',
      '  id("MIX").steps([',
    ).replace('chain("wet").level(0.5)', 'chain("OUT").level(0.5)');
    expect(issuesOf(sink).join(" ")).toMatch(/built-in end/);
    const twice = GTR.replace(
      "  ]),\n])\n",
      '  ]),\n  id("wet").steps([to([chain("MIX")])]),\n])\n',
    );
    expect(issuesOf(twice).join(" ")).toMatch(/two subchains/);
  });

  it("vet a subchain node's module fields like any node's", () => {
    const bad = GTR.replace(
      `    id("eq-1").extends(${AMP}),`,
      `    id("eq-1").extends(${AMP}).params(3),`,
    );
    expect(parseChain(bad).issues[0]?.path).toMatch(/^subchains\.0\.steps\.1/);
  });

  it("let an item inside one be edited in place", () => {
    const out = spliceChainItem(GTR, "eq-1", (t) =>
      t.setIn(["params"], { Gain: 2 }),
    );
    const value = parseChain(out).value;
    const eq = value?.subchains?.[0].steps[1] as { params?: unknown };
    expect(eq.params).toEqual({ Gain: 2 });
  });
});

let root: string;
let dir: string;
const put = (rel: string, text: string): void => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text, "utf8");
};
// biome-ignore lint/suspicious/noExplicitAny: the tests reach into the file's data by shape.
const chain = (name: string): any => wsData(join(dir, "chains", `${name}.k7x`));
const segments = () =>
  toSegments(readChainProject(dir), readLayout(dir)).graph.modules ?? {};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "chain-subs-"));
  dir = join(root, "song");
  put("project.k7x", 'project({ name: "t", tempo: 120 })\n');
  put("tracks/gtr.k7x", 'extends("@meta/track")\nevents([])\n');
  put("tracks/bass.k7x", 'extends("@meta/track")\nevents([])\n');
  put("chains/gtr.k7x", GTR);
  // A top-level chain with the subchain's name: inside gtr it is shadowed, outside it is the one reached.
  put(
    "chains/wet.k7x",
    `steps([id("plate-1").extends(${AMP}), to([chain("MIX")])])\n`,
  );
  put(
    "chains/bass.k7x",
    'start(true)\nsteps([id("lane-bass").track("bass"), to([chain("wet")])])\n',
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a project with subchains", () => {
  it("knows each node's subchain, and shows where it sits", () => {
    const n = readChainProject(dir).nodes["eq-1"];
    expect(n).toMatchObject({ chain: "gtr", sub: "wet", step: 1 });
    expect(placeOf(n)).toBe("gtr › wet · step 2");
  });

  it("compiles a link to the subchain inside its parent, and to the chain of that name outside it", () => {
    const m = segments();
    expect(m["amp-1"]).toEqual(["verb-1", "MIX"]);
    expect(m["verb-1"]).toEqual(["eq-1"]);
    expect(m["eq-1"]).toEqual(["MIX"]);
    expect(m.bass).toEqual(["plate-1"]);
  });

  it("writes a subchain back into its parent after an unrelated edit", () => {
    editChainGraph(dir, (t) => setModuleEnabled(t, "amp-1", false));
    const gtr = chain("gtr");
    expect(gtr.steps[1].bypass).toBe(true);
    expect(gtr.subchains).toEqual([
      {
        id: "wet",
        steps: [
          { id: "verb-1", extends: "@k7-core/audio/amp" },
          { id: "eq-1", extends: "@k7-core/audio/amp" },
          { to: [{ chain: "MIX" }] },
        ],
      },
    ]);
    expect(readFileSync(join(dir, "chains", "gtr.k7x"), "utf8")).toContain(
      "// the room",
    );
  });

  it("keeps a node put at the subchain's head inside it", () => {
    editChainGraph(dir, (t) => insertBetween(t, "amp-1", "verb-1", "pre-1"), {
      add: { "pre-1": { id: "pre-1", extends: "@k7-core/audio/amp" } as never },
    });
    const sub = chain("gtr").subchains?.[0];
    expect(sub?.id).toBe("wet");
    expect(sub?.steps.map((s: { id?: string }) => s.id)).toEqual([
      "pre-1",
      "verb-1",
      "eq-1",
      undefined,
    ]);
  });

  it("lifts a subchain out to a chain of its own once something outside feeds it", () => {
    editChainGraph(dir, (t) => connectNodes(t, "plate-1", "verb-1"));
    expect(chain("gtr").subchains).toBeUndefined();
    const lifted = chain("gtr-wet");
    expect(lifted.steps[0].id).toBe("verb-1");
    expect(
      chain("gtr")
        .steps.at(-1)
        .to.map((l: { chain: string }) => l.chain),
    ).toContain("gtr-wet");
  });
});
