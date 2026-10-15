// parse.test.ts — the grammar: what each form reads as, and where a mistake is reported.

import { describe, expect, it } from "vitest";
import { parse } from "./edit.ts";
import { K7SyntaxError } from "./parse.ts";
import { stringify } from "./print.ts";

describe("nesting", () => {
  it("refuses a file nested past MAX_DEPTH as a syntax error, not a stack overflow", () => {
    const deep = `a(${"[".repeat(100_000)}${"]".repeat(100_000)})`;
    expect(() => parse(deep)).toThrow(K7SyntaxError);
    expect(() => parse(deep)).toThrow(/nested deeper than 256/);
    const objects = `a(${"{ b: ".repeat(300)}1${" }".repeat(300)})`;
    expect(() => parse(objects)).toThrow(K7SyntaxError);
  });

  it("still reads a value nested within the limit", () => {
    expect(parse(`a(${"[".repeat(200)}${"]".repeat(200)})`)).toHaveProperty(
      "a",
    );
  });
});

describe("k7x grammar", () => {
  it("reads statements, chains, objects and lists as one map", () => {
    const text = `// a comment
project({ name: "demo", tempo: 120, video: false })
steps([
  extends("@k7-core/audio/compressor").engine('tracktion'),
  to([chain("@out")]), /* trailing comma */
])
markers({})`;
    expect(parse(text)).toEqual({
      project: { name: "demo", tempo: 120, video: false },
      steps: [
        { extends: "@k7-core/audio/compressor", engine: "tracktion" },
        { to: [{ chain: "@out" }] },
      ],
      markers: {},
    });
  });

  it("continues a chain across lines, and a root chain is several entries", () => {
    expect(parse("a(1)\n  .b(2)\nc(3).d(4)")).toEqual({
      a: 1,
      b: 2,
      c: 3,
      d: 4,
    });
  });

  it("reads a call's arguments: none is true, several a list", () => {
    expect(parse("a() b(1, 2) c([1]) d(null)")).toEqual({
      a: true,
      b: [1, 2],
      c: [1],
      d: null,
    });
  });

  it("takes quoted keys, dashed keys and reserved words as keys", () => {
    expect(
      parse(
        `"Filter Freq"(40) synth-pad(["MIX"]) x({ "pad#midi": 1, true: 2 })`,
      ),
    ).toEqual({
      "Filter Freq": 40,
      "synth-pad": ["MIX"],
      x: { "pad#midi": 1, true: 2 },
    });
  });

  it("reads strings: escapes, single quotes, raw multi-line backticks", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a k7x backtick never interpolates, which is what this asserts.
    const raw = "`line 1\n  \\` ${x} \\\\`";
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the same literal ${x}, read back.
    const read = "line 1\n  ` ${x} \\";
    expect(parse(`a("é\\n\\u0041") b('it\\'s') c(${raw})`)).toEqual({
      a: "é\nA",
      b: "it's",
      c: read,
    });
  });

  it("reads an empty file as an empty map", () => {
    expect(parse("")).toEqual({});
    expect(parse("// only a comment\n")).toEqual({});
  });

  it.each([
    ["a(1", 'expected "," or ")"'],
    ["a(foo)", 'bare word "foo"'],
    ["a(1) a(2)", 'duplicate key "a"'],
    ["a({ b 1 })", 'expected ":" after b'],
    ['a("x\ny")', "unterminated string"],
    ["a(01)", 'expected "," or ")"'],
  ])("rejects %j", (text, message) => {
    expect(() => parse(text)).toThrow(message);
  });

  it("reports the line and column", () => {
    try {
      parse("a(1)\nb(2,, 3)");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(K7SyntaxError);
      expect((e as K7SyntaxError).line).toBe(2);
      expect((e as K7SyntaxError).column).toBe(5);
    }
  });
});

describe("stringify", () => {
  const value = {
    project: {
      name: "synth-demo",
      tempo: 120,
      sampleRate: 48000,
      timeSignature: "4/4",
      video: false,
      layers: [],
    },
    markers: {},
    notes: Array.from({ length: 3 }, (_, i) => ({ t: i, d: 1, k: 60 + i })),
    params: { "Filter Freq": 40, Level: -12.5 },
    content: "two\nlines with a ` and a \\",
    steps: [
      {
        extends: "@k7-core/audio/compressor",
        engine: "tracktion",
        engines: {
          tracktion: {
            params: {
              Ratio: 0.125,
              Attack: 12,
              Release: 140,
              Knee: 3,
              Makeup: 0,
            },
          },
        },
      },
      { to: [{ chain: "@out" }] },
    ],
  };

  it("reads back what it writes", () => {
    expect(parse(stringify(value))).toEqual(value);
  });

  it("writes the canonical layout", () => {
    expect(stringify(value)).toMatchInlineSnapshot(`
      "project({
        name: "synth-demo",
        tempo: 120,
        sampleRate: 48000,
        timeSignature: "4/4",
        video: false,
        layers: [],
      })
      markers({})
      notes([t(0).d(1).k(60), t(1).d(1).k(61), t(2).d(1).k(62)])
      params({ "Filter Freq": 40, Level: -12.5 })
      content(\`two
      lines with a \\\` and a \\\\\`)
      steps([
        extends("@k7-core/audio/compressor")
          .engine("tracktion")
          .engines({
            tracktion: { params: { Ratio: 0.125, Attack: 12, Release: 140, Knee: 3, Makeup: 0 } },
          }),
        to([chain("@out")]),
      ])
      "
    `);
  });
});
