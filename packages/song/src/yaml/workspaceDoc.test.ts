// workspaceDoc.test.ts — a .k7x file read and written as k7x: edits keep comments, short forms survive what leaves them true.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { K7SyntaxError } from "@studio/k7x/parse";
import { splitNote } from "@studio/song-schema/yaml/sequenceFile";
import { expandNotes } from "@studio/song-schema/yaml/sugar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  wsData,
  wsEdit,
  wsText,
  wsWriteData,
  wsWriteText,
} from "./workspaceDoc";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ws-doc-"));
  mkdirSync(join(dir, "sequences"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const at = (name: string): string => join(dir, name);
const read = (name: string): string => readFileSync(at(name), "utf8");
const PROJECT = `// the song
project({ name: "demo", tempo: 120 }) // a comment that must survive
`;

describe("reading a .k7x file", () => {
  it("gives its text as written and its data", () => {
    writeFileSync(at("project.k7x"), PROJECT);
    expect(wsText(at("project.k7x"))).toBe(PROJECT);
    expect(wsData(at("project.k7x"))).toEqual({
      project: { name: "demo", tempo: 120 },
    });
  });

  it("expands short forms in its data", () => {
    writeFileSync(at("sequences/riff.k7x"), 'notes("c4 d4")\n');
    expect(wsData(at("sequences/riff.k7x")).notes).toEqual(
      expandNotes("c4 d4"),
    );
  });

  it("refuses a YAML name, which this door never resolves", () => {
    writeFileSync(at("project.k7x"), PROJECT);
    expect(() => wsText(at("project.yaml"))).toThrow("not a .k7x file");
  });
});

describe("editing a .k7x file", () => {
  it("changes one value, its comments kept", () => {
    writeFileSync(at("project.k7x"), PROJECT);
    const wrote = wsEdit(at("project.k7x"), (d) =>
      d.setIn(["project", "tempo"], 128),
    );
    expect(wrote).toBe(true);
    expect(read("project.k7x")).toBe(PROJECT.replace("120", "128"));
  });

  it("writes nothing when the text does not change", () => {
    writeFileSync(at("project.k7x"), PROJECT);
    const wrote = wsEdit(at("project.k7x"), (d) =>
      d.setIn(["project", "tempo"], 120),
    );
    expect(wrote).toBe(false);
    expect(read("project.k7x")).toBe(PROJECT);
  });

  it("creates an absent file only when asked", () => {
    const edit = (d: { setIn: (p: string[], v: unknown) => void }) =>
      d.setIn(["project", "name"], "new");
    expect(() => wsEdit(at("project.k7x"), edit)).toThrow("no such file");
    expect(existsSync(at("project.k7x"))).toBe(false);
    expect(wsEdit(at("project.k7x"), edit, { create: true })).toBe(true);
    expect(wsData(at("project.k7x"))).toEqual({ project: { name: "new" } });
  });

  it("leaves the file whole when the edit throws, and no temp behind", () => {
    writeFileSync(at("project.k7x"), PROJECT);
    expect(() =>
      wsEdit(at("project.k7x"), (d) => {
        d.setIn(["project", "tempo"], 90);
        throw new Error("midway");
      }),
    ).toThrow("midway");
    expect(read("project.k7x")).toBe(PROJECT);
    wsEdit(at("project.k7x"), (d) => d.setIn(["project", "tempo"], 90));
    expect(readdirSync(dir).sort()).toEqual(["project.k7x", "sequences"]);
  });
});

describe("editing a file that could hold short forms but does not", () => {
  it("splits a note in a full-form sequence, every other note's comment kept", () => {
    const src =
      "notes([\n  t(0).d(1).k(60), // the root\n  t(1).d(1).k(62), // the second\n  t(2).d(1).k(64), // the third\n])\n";
    writeFileSync(at("sequences/melody.k7x"), src);
    wsEdit(at("sequences/melody.k7x"), (d) => splitNote(d.at([]), 62, 1, 1.5));
    const out = read("sequences/melody.k7x");
    expect(out).toContain("t(1).d(0.5).k(62), // the second");
    expect(out).toContain("t(2).d(1).k(64), // the third");
    expect(out).toContain("// the root");
  });

  it("renames a graph key where it stands", () => {
    const src = 'modules({\n  a: ["b"], // first\n  b: ["OUT"],\n})\n';
    writeFileSync(at("graph.k7x"), src);
    wsEdit(at("graph.k7x"), (d) => d.renameKey(["modules", "a"], "z"));
    expect(read("graph.k7x")).toBe(src.replace("a:", "z:"));
  });
});

describe("editing a file written with short forms", () => {
  it("hands a raw edit the short forms as written", () => {
    const src = 'runs([["a", "b", "OUT"]])\n';
    writeFileSync(at("graph.k7x"), src);
    let seen: unknown;
    wsEdit(
      at("graph.k7x"),
      (d) => {
        seen = d.toJS();
      },
      { raw: true },
    );
    expect(seen).toEqual({ runs: [["a", "b", "OUT"]] });
  });

  const SEQ = '// the riff\nnotes("c4 d4") // two notes\nto("2:1")\n';
  const seq = "sequences/riff.k7x";

  it("shows the edit the expanded notes", () => {
    writeFileSync(at(seq), SEQ);
    let seen: unknown;
    wsEdit(at(seq), (d) => {
      seen = d.getIn(["notes"]);
    });
    expect(seen).toEqual(expandNotes("c4 d4"));
    expect(read(seq)).toBe(SEQ);
  });

  it("keeps notes(…) when an unrelated key changes", () => {
    writeFileSync(at(seq), SEQ);
    expect(wsEdit(at(seq), (d) => d.setIn(["to"], "3:1"))).toBe(true);
    expect(read(seq)).toBe(SEQ.replace('"2:1"', '"3:1"'));
  });

  it("writes the notes in full once one changes", () => {
    writeFileSync(at(seq), SEQ);
    wsEdit(at(seq), (d) => d.setIn(["notes", 1, "k"], 64));
    const out = read(seq);
    expect(out).toContain("// the riff");
    expect(out).not.toContain('notes("');
    expect(wsData(at(seq)).notes).toEqual(expandNotes("c4 e4"));
  });

  const GRAPH =
    '// the graph\nruns([["melody", "lead", "OUT"]])\nbypassed([])\n';

  it("keeps runs(…) through an edit elsewhere in the graph", () => {
    writeFileSync(at("graph.k7x"), GRAPH);
    wsEdit(at("graph.k7x"), (d) => d.setIn(["bypassed"], ["lead"]));
    expect(read("graph.k7x")).toBe(
      GRAPH.replace("bypassed([])", 'bypassed(["lead"])'),
    );
  });

  it("drops runs(…) for modules once a segment changes", () => {
    writeFileSync(at("graph.k7x"), GRAPH);
    wsEdit(at("graph.k7x"), (d) => d.setIn(["modules", "lead"], []));
    expect(read("graph.k7x")).not.toContain("runs(");
    expect(wsData(at("graph.k7x")).modules).toEqual({
      melody: ["lead"],
      lead: [],
    });
  });

  it("takes a header the edit changed", () => {
    writeFileSync(at(seq), SEQ);
    wsEdit(at(seq), (d) => d.setHeader(["a riff"]));
    expect(read(seq)).toBe(SEQ.replace("the riff", "a riff"));
  });

  it("keeps seq(…), a byte-order mark and CRLF through an unrelated edit", () => {
    const src = '﻿// h\r\nnotes(seq("c4 d4").step(0.5).v(0.8))\r\nto("2:1")\r\n';
    writeFileSync(at(seq), src);
    expect(wsEdit(at(seq), () => {})).toBe(false);
    wsEdit(at(seq), (d) => d.setIn(["to"], "3:1"));
    expect(read(seq)).toBe(src.replace("2:1", "3:1"));
  });

  it("drops runs(…) written beside modules once a segment changes", () => {
    writeFileSync(
      at("graph.k7x"),
      'modules({ a: ["b"] })\nruns([["x", "y", "OUT"]])\n',
    );
    wsEdit(at("graph.k7x"), (d) => d.setIn(["modules", "a"], ["c"]));
    expect(read("graph.k7x")).not.toContain("runs(");
    expect(wsData(at("graph.k7x")).modules).toEqual({
      a: ["c"],
      x: ["y"],
      y: ["OUT"],
    });
  });
});

describe("writing a .k7x file whole", () => {
  it("prints data canonically, with a header and inline nodes", () => {
    const value = { project: { name: "demo" }, notes: [{ t: 0, d: 1, k: 60 }] };
    expect(
      wsWriteData(at("p.k7x"), value, {
        header: ["written"],
        inline: (p) => p[0] === "notes",
      }),
    ).toBe(true);
    expect(read("p.k7x").startsWith("// written\n")).toBe(true);
    expect(wsData(at("p.k7x"))).toEqual(value);
    expect(wsWriteData(at("p.k7x"), value, { header: ["written"] })).toBe(
      false,
    );
  });

  it("writes text that reads, and refuses text that does not", () => {
    expect(wsWriteText(at("project.k7x"), PROJECT)).toBe(true);
    expect(read("project.k7x")).toBe(PROJECT);
    expect(() => wsWriteText(at("project.k7x"), "project({")).toThrow(
      K7SyntaxError,
    );
    expect(read("project.k7x")).toBe(PROJECT);
    expect(wsWriteText(at("project.k7x"), PROJECT)).toBe(false);
  });
});
