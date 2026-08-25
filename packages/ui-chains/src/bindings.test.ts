// The graph half of a surface's binding join, which two surfaces now share. What can go wrong here
// is silent on both of them: a module found in the wrong chain, a widget matched to the wrong param,
// and above all the PLUGLESS policy — the desk binds an `offline` module by its track, the mastering
// strip refuses it, and swapping those makes one surface send to an address the engine has not got.
//
// It also covers st0's mastering resolve for the first time: that one had no direct test at all.

import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import {
  resolveMapping,
  resolveTarget,
  stepsByModule,
  unmappedControls,
  widgetFor,
} from "./bindings";

/** A graph of one chain, spelled the way `buildGraphDoc` spells one. */
const graphWith = (
  chains: Record<
    string,
    {
      from?: string;
      use: {
        module: string;
        pluginId?: string;
        widgets?: Record<string, unknown>;
      }[];
    }
  >,
): WebGraph =>
  ({
    chains: Object.fromEntries(
      Object.entries(chains).map(([id, c]) => [
        id,
        {
          ...(c.from ? { from: c.from } : {}),
          use: c.use.map((s) => ({
            module: s.module,
            ...(s.pluginId ? { pluginId: s.pluginId } : {}),
            ...(s.widgets ? { ui: { widgets: s.widgets } } : {}),
          })),
          out: [],
        },
      ]),
    ),
  }) as unknown as WebGraph;

const CONTROLS = [{ id: "a.one" }, { id: "a.two" }];
const control = (id: string) => CONTROLS.find((c) => c.id === id);

describe("stepsByModule", () => {
  it("keys every chain's steps by the name the chains file uses", () => {
    const steps = stepsByModule(
      graphWith({ bus: { use: [{ module: "eqA" }, { module: "filterA" }] } }),
    );
    expect([...steps.keys()].sort()).toEqual(["eqA", "filterA"]);
  });

  it("carries the chain's SOURCE track, which is a plugin-less module's only address", () => {
    // Without this an `offline` tempo has nowhere to land, and its fader moves nothing in silence.
    const steps = stepsByModule(
      graphWith({ deckA: { from: "deckA", use: [{ module: "tempoA" }] } }),
    );
    expect(steps.get("tempoA")?.track).toBe("deckA");
  });

  it("keeps the FIRST use of a module named twice", () => {
    // A mapping names a NODE, so a second use is not a second answer to the same question.
    const steps = stepsByModule(
      graphWith({
        one: { from: "t1", use: [{ module: "fade", pluginId: "one:fade" }] },
        two: { from: "t2", use: [{ module: "fade", pluginId: "two:fade" }] },
      }),
    );
    expect(steps.get("fade")?.step.pluginId).toBe("one:fade");
  });

  it("answers for a graph that is null, which is a project that will not compile", () => {
    expect(stepsByModule(null).size).toBe(0);
  });
});

describe("widgetFor", () => {
  it("finds the widget BOUND to the param, not the one named after it", () => {
    const [step] = [
      ...stepsByModule(
        graphWith({
          bus: {
            use: [
              {
                module: "eqA",
                widgets: { low: { bind: "Low-shelf gain", min: -20, max: 20 } },
              },
            ],
          },
        }),
      ).values(),
    ];
    expect(widgetFor(step.step, "Low-shelf gain")).toMatchObject({ min: -20 });
    expect(widgetFor(step.step, "Mid gain 1")).toBeUndefined();
  });

  it("is undefined rather than fatal when the module draws no panel", () => {
    const found = stepsByModule(graphWith({ bus: { use: [{ module: "m" }] } }));
    expect(widgetFor(found.get("m")!.step, "anything")).toBeUndefined();
  });
});

describe("the plugless policy", () => {
  const plugless = stepsByModule(
    graphWith({ deckA: { from: "deckA", use: [{ module: "tempoA" }] } }),
  ).get("tempoA");
  const orphan = stepsByModule(
    graphWith({ bus: { use: [{ module: "lonely" }] } }),
  ).get("lonely");

  it("binds a plugin-less module by its TRACK under `track` — the desk's answer", () => {
    const t = resolveTarget(
      plugless,
      { module: "tempoA", param: "Target BPM" },
      "track",
    );
    expect(typeof t).not.toBe("string");
    expect(t).toMatchObject({ track: "deckA" });
    expect((t as { pluginId?: string }).pluginId).toBeUndefined();
  });

  it("REFUSES the same module under `refuse` — the mastering strip's", () => {
    const t = resolveTarget(
      plugless,
      { module: "tempoA", param: "x" },
      "refuse",
    );
    // The two surfaces disagree deliberately; this is the line that keeps them able to.
    expect(typeof t).toBe("string");
    expect(t).toContain("ne charge aucun plugin");
  });

  it("refuses a module with neither a plugin nor a track, under either policy", () => {
    for (const p of ["track", "refuse"] as const)
      expect(
        typeof resolveTarget(orphan, { module: "lonely", param: "x" }, p),
      ).toBe("string");
  });

  it("names a module the graph has not got at all", () => {
    const t = resolveTarget(undefined, { module: "nope", param: "x" }, "track");
    expect(t).toContain("aucun module");
    expect(t).toContain("nope");
  });
});

describe("resolveMapping", () => {
  const graph = graphWith({
    bus: {
      use: [
        {
          module: "eqA",
          pluginId: "bus:eqA",
          widgets: { g: { bind: "Low", min: -20, max: 20 } },
        },
      ],
    },
  });

  it("resolves a line to its plugin and its widget", () => {
    const { rows, problems } = resolveMapping(
      { "a.one": { module: "eqA", param: "Low" } },
      graph,
      { control, noun: "du pupitre", plugless: "track" },
    );
    expect(problems).toEqual([]);
    expect(rows[0].target).toMatchObject({ pluginId: "bus:eqA", param: "Low" });
    expect(rows[0].target.widget).toMatchObject({ min: -20 });
  });

  it("reports an id this surface does not have, in ITS OWN words", () => {
    // The noun is the caller's: two surfaces share the sentence and not the name they go by.
    const { problems } = resolveMapping(
      { nope: { module: "eqA", param: "Low" } },
      graph,
      { control, noun: "du pupitre", plugless: "track" },
    );
    expect(problems[0].message).toContain("pupitre");
    expect(
      resolveMapping({ nope: { module: "eqA", param: "Low" } }, graph, {
        control,
        noun: "de cette surface",
        plugless: "refuse",
      }).problems[0].message,
    ).toContain("cette surface");
  });

  it("SKIPS a control named but not wired, without a word", () => {
    // That is what a scaffolded surface is made of; the gate reports it once, over the whole surface.
    const { rows, problems } = resolveMapping({ "a.one": null }, graph, {
      control,
      noun: "du pupitre",
      plugless: "track",
    });
    expect(rows).toEqual([]);
    expect(problems).toEqual([]);
  });

  it("carries `invert` through, and only when it is set", () => {
    const on = resolveMapping(
      { "a.one": { module: "eqA", param: "Low", invert: true } },
      graph,
      { control, noun: "x", plugless: "track" },
    );
    expect(on.rows[0].target.invert).toBe(true);
    const off = resolveMapping(
      { "a.one": { module: "eqA", param: "Low" } },
      graph,
      {
        control,
        noun: "x",
        plugless: "track",
      },
    );
    expect(off.rows[0].target.invert).toBeUndefined();
  });

  it("hands the LINE back, so a surface can resolve its own `also:`", () => {
    const { rows } = resolveMapping(
      {
        "a.one": {
          module: "eqA",
          param: "Low",
          also: { module: "eqA", param: "High" },
        },
      },
      graph,
      { control, noun: "x", plugless: "track" },
    );
    expect(rows[0].binding.also).toEqual({ module: "eqA", param: "High" });
  });

  it("reports every bad line rather than stopping at the first", () => {
    const { problems } = resolveMapping(
      {
        nope: { module: "eqA", param: "L" },
        "a.one": { module: "gone", param: "L" },
      },
      graph,
      { control, noun: "x", plugless: "track" },
    );
    expect(problems).toHaveLength(2);
  });
});

describe("unmappedControls", () => {
  it("is every control when there is no mapping at all", () => {
    expect(unmappedControls(CONTROLS, undefined)).toEqual(CONTROLS);
    expect(unmappedControls(CONTROLS, {})).toEqual(CONTROLS);
  });

  it("counts a NULL line as unwired — which is exactly what a scaffold writes", () => {
    expect(unmappedControls(CONTROLS, { "a.one": null })).toEqual(CONTROLS);
  });

  it("is empty once every control names a module", () => {
    const wired = Object.fromEntries(
      CONTROLS.map((c) => [c.id, { module: "m", param: "p" }]),
    );
    expect(unmappedControls(CONTROLS, wired)).toEqual([]);
  });

  it("does NOT check that the module exists — that is a different fix", () => {
    // "not wired" and "wired to something absent" are two sentences; `resolveMapping` says the second.
    const wired = Object.fromEntries(
      CONTROLS.map((c) => [c.id, { module: "absent", param: "p" }]),
    );
    expect(unmappedControls(CONTROLS, wired)).toEqual([]);
  });
});
