// k7xEditor.test.ts — the k7x mode headless: its colours on real StringStreams, its completion on a real EditorState.

import {
  autocompletion,
  CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { StringStream } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { Hints } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { schemaVocabulary } from "../yaml/vocabulary";
import { k7xCompletions } from "./completions";
import { type K7xState, k7xStartState, k7xToken } from "./language";

/** One line through the tokeniser: the styled pieces, whitespace dropped. */
function scan(line: string, state: K7xState = k7xStartState()) {
  const stream = new StringStream(line, 2, 2);
  const out: { text: string; style: string }[] = [];
  while (!stream.eol()) {
    const from = stream.pos;
    const style = k7xToken(stream, state);
    expect(stream.pos, `no progress in ${line}`).toBeGreaterThan(from);
    if (style) out.push({ text: stream.current(), style });
    stream.start = stream.pos;
  }
  return out;
}

describe("the k7x colours", () => {
  it("tell a key by the bracket or colon after it", () => {
    expect(scan('params({ "Filter Freq": 40, Level: -12 }) // dark')).toEqual([
      { text: "params", style: "propertyName" },
      { text: "(", style: "bracket" },
      { text: "{", style: "bracket" },
      { text: '"Filter Freq"', style: "propertyName" },
      { text: ":", style: "punctuation" },
      { text: "40", style: "number" },
      { text: ",", style: "punctuation" },
      { text: "Level", style: "propertyName" },
      { text: ":", style: "punctuation" },
      { text: "-12", style: "number" },
      { text: "}", style: "bracket" },
      { text: ")", style: "bracket" },
      { text: "// dark", style: "comment" },
    ]);
  });

  it("colour values, and a bare word as the mistake it is", () => {
    const styles = scan('a(true, null, "x", oops)').map((x) => x.style);
    expect(styles).toEqual([
      "propertyName",
      "bracket",
      "bool",
      "punctuation",
      "null",
      "punctuation",
      "string",
      "punctuation",
      "invalid",
      "bracket",
    ]);
  });

  it("carry a backtick string and a block comment across lines", () => {
    const state = k7xStartState();
    expect(scan("content(`first", state).at(-1)?.style).toBe("string");
    expect(state.open).toBe("raw");
    expect(scan("still` )", state)[0]).toEqual({
      text: "still`",
      style: "string",
    });
    expect(state.open).toBeNull();
    scan("/* open", state);
    expect(state.open).toBe("block");
  });
});

const HINTS = {
  baseModules: ["@workspace/instruments/synth", "@engine/audio/amp"],
} as Hints;

function complete(path: string, doc: string): CompletionResult | null {
  const state = EditorState.create({ doc, extensions: [autocompletion()] });
  const source = k7xCompletions(schemaVocabulary(path, HINTS));
  return source(
    new CompletionContext(state, doc.length, true),
  ) as CompletionResult | null;
}
const labels = (r: CompletionResult | null) =>
  (r?.options ?? []).map((o) => o.label);

describe("the k7x completion", () => {
  it("offers a module's keys at the top level", () => {
    const r = complete("song/nodes/pad.k7x", "par");
    expect(labels(r)).toEqual(
      expect.arrayContaining(["params", "plugin", "extends"]),
    );
    expect(r?.from).toBe(0);
  });

  it("offers what a node may extend, quoted, and no scanned plugin", () => {
    const r = complete("song/nodes/pad.k7x", "extends(");
    expect(labels(r)).toEqual(["@workspace/instruments/synth"]);
    expect(r?.options[0].apply).toBe('"@workspace/instruments/synth"');
  });

  it("offers it inside the quotes already typed, without quotes of its own", () => {
    const r = complete("song/nodes/pad.k7x", 'extends("@wor');
    expect(labels(r)).toEqual(["@workspace/instruments/synth"]);
    expect(r?.options[0].apply).toBeUndefined();
    expect(r?.from).toBe('extends("'.length);
  });

  it("offers a project's settings inside its object", () => {
    const r = complete("song/project.k7x", 'project({ name: "demo", ');
    expect(labels(r)).toEqual(
      expect.arrayContaining(["tempo", "timeSignature"]),
    );
  });
});
