// What a live input's panel needs to be more than a picture.
//
// An io "in" module runs no plugin, and every widget in the graph was built for one: a knob sends a param to a
// pluginId, a waveform reads a tap keyed by pluginId. So an input drew its panel and nothing in it worked —
// there was no id to address and no param to send. These are the two answers, both computed here because this
// is the only place that knows both the module and the chain it sits in.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeModule, writeYaml } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGraphDoc } from "./graphDoc";

let root: string;
let proj: string;

const IN = "@workspace/io/IN:in-2";
const chains = (text: string) =>
  writeFileSync(join(proj, "graph.yaml"), text, "utf8");

/** The step for the live input, wherever the derivation put it. */
const inputStep = () => {
  const g = buildGraphDoc(proj);
  return Object.values(g.chains)
    .flatMap((c) => c.use)
    .find((s) => s.module === IN);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-inwidget-"));
  proj = join(root, "song");
  mkdirSync(join(proj, "nodes"), { recursive: true });
  writeYaml(join(proj, "project.yaml"), {
    project: { name: "song", modules_from: ["../_modules"] },
  });
  writeFileSync(
    join(proj, "nodes", "gtr.yaml"),
    'extends: "@studio/track"\nevents: []\n',
    "utf8",
  );
  writeModule(proj, "audio", "amp", {
    plugin: { type: "internal", name: "Chorus" },
  });
  // The shared catalogue as `module populate` leaves it: a generic IN, one node per channel.
  mkdirSync(join(root, "_modules", "io", "IN"), { recursive: true });
  writeFileSync(join(root, "_modules", "io", "IN", "module.yaml"), "io: in\n");
  writeFileSync(
    join(root, "_modules", "io", "IN", "in-2.yaml"),
    "channel: [2]\n",
  );
  chains(`modules:\n  gtr: [ amp ]\n  amp: [ OUT ]\n  "${IN}": [ gtr ]\n`);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a live input's monitor", () => {
  it("comes through as the module's own field", () => {
    // Not a param — there is no plugin to hold one — so it rides on the step itself, which
    // is what lets a widget bound to `@monitor` show anything at all.
    expect(inputStep()?.monitor).toBe("auto");
    expect(inputStep()?.params).toEqual({});
  });

  it("reads what the module file says", () => {
    writeFileSync(
      join(root, "_modules", "io", "IN", "in-2.yaml"),
      'channel: [2]\nmonitor: "on"\n',
      "utf8",
    );
    expect(inputStep()?.monitor).toBe("on");
  });

  it("is absent on a module that is not an input", () => {
    // A knob on an ordinary module must not grow a monitor it has no business having.
    const g = buildGraphDoc(proj);
    expect(g.chains.gtr.use.find((s) => s.module === "amp")?.monitor).toBe(
      undefined,
    );
  });
});

describe("a live input's waveform", () => {
  it("listens to the INPUT of the first module on the lane it feeds", () => {
    // The input has no plugin of its own, so there is nothing on it to tap. Its signal
    // arrives one step downstream, at the lane's first module — the same audio, and the
    // only place the engine can be asked for it.
    expect(inputStep()?.pluginId).toBe(undefined);
    expect(inputStep()?.tap).toEqual({ id: "gtr:amp", side: "input" });
  });

  it("names an id the engine really has", () => {
    // The tap borrows a pluginId, so it has to be one that was actually assigned — a step
    // that earned no id (a stub, an unknown format) would be a key nothing ever fills.
    const g = buildGraphDoc(proj);
    const ids = Object.values(g.chains)
      .flatMap((c) => c.use)
      .map((s) => s.pluginId)
      .filter(Boolean);
    expect(ids).toContain(inputStep()?.tap?.id);
  });

  it("has none when the lane runs no plugins", () => {
    // Better than pointing at a plugin that isn't there: the widget draws its empty box,
    // which is honest, instead of listening to a key nothing writes.
    chains(`modules:\n  gtr: [ OUT ]\n  "${IN}": [ gtr ]\n`);
    expect(inputStep()?.tap).toBe(undefined);
  });

  it("follows the input when it sits INSIDE the lane's run instead", () => {
    // The other way of wiring one, which the migration writes. Same lane, same tap.
    chains(
      `modules:\n  gtr: [ "${IN}" ]\n  "${IN}": [ amp ]\n  amp: [ OUT ]\n`,
    );
    expect(inputStep()?.tap).toEqual({ id: "gtr:amp", side: "input" });
  });
});
