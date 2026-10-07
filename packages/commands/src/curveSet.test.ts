// `curve set` — a curve written whole from the editor's fields: created, replaced, and refused when
// the fields are not a curve, leaving the file as it was.

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
import { parse } from "yaml";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "curve-set-"));
  mkdirSync(join(dir, "nodes"));
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = async (line: string) => {
  const h = testHost({ songPath: dir });
  await runCommand(line, h, "cli");
  return h;
};
const read = () => parse(readFileSync(join(dir, "curves/wob.yaml"), "utf8"));

describe("curve set", () => {
  it("creates the curve from its fields, then replaces it whole", async () => {
    const h = await run(
      'curve set wob {"type":"lfo","shape":"saw","frequency":2,"phase":0.25,"amplitude":0.5}',
    );
    expect(h.lines.refuse).toEqual([]);
    expect(h.lines.log[0]).toMatch(/created curves\/wob\.yaml/);
    expect(read()).toEqual({
      type: "lfo",
      shape: "saw",
      frequency: 2,
      phase: 0.25,
      amplitude: 0.5,
    });
    await run(
      'curve set wob {"type":"adsr","attack":10,"decay":20,"sustain":30,"release":40}',
    );
    expect(read()).toEqual({
      type: "adsr",
      attack: 10,
      decay: 20,
      sustain: 30,
      release: 40,
    });
  });

  it("writes an on/off curve, and refuses a point between off and on", async () => {
    await run(
      'curve set wob {"type":"onoff","points":[{"time":"1:1:1","value":0},{"time":"2:1:1","value":1}]}',
    );
    expect(read()).toEqual({
      type: "onoff",
      points: [
        { time: "1:1:1", value: 0 },
        { time: "2:1:1", value: 1 },
      ],
    });
    const h = await run(
      'curve set wob {"type":"onoff","points":[{"time":"1:1:1","value":0.5}]}',
    );
    expect(h.lines.refuse.join(" ")).toMatch(/0 or 1/);
  });

  it("refuses fields that are not a curve, writing nothing", async () => {
    const h = await run('curve set wob {"type":"lfo","amplitude":3}');
    expect(h.lines.refuse.join(" ")).toMatch(/amplitude/);
    expect(() => read()).toThrow();
  });
});
