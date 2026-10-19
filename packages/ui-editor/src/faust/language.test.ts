// The Faust tokeniser, driven against a real StringStream. Nothing here mounts an editor, so
// this is the only way to prove the colours — and the parts worth proving are the ones a glance
// at a screenshot would not catch: the composition operators, an unclosed comment or string, and
// the fact that every name returned is one CodeMirror actually knows.

import { StringStream } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { describe, expect, it } from "vitest";
import { type FaustState, faustStartState, faustToken } from "./language";

/** One line through the tokeniser: the pairs it produces, whitespace dropped. */
function scan(
  line: string,
  state: FaustState = faustStartState(),
): { text: string; style: string }[] {
  const stream = new StringStream(line, 2, 2);
  const out: { text: string; style: string }[] = [];
  // A tokeniser that returns without consuming would spin forever; the guard is the assertion.
  let guard = 0;
  while (!stream.eol()) {
    const at = stream.pos;
    const style = faustToken(stream, state);
    expect(
      stream.pos,
      `no progress at ${stream.pos} in ${line}`,
    ).toBeGreaterThan(at);
    if (style) out.push({ text: stream.current(), style });
    stream.start = stream.pos;
    if (++guard > 500) throw new Error("runaway");
  }
  return out;
}

const styles = (line: string) => scan(line).map((x) => x.style);
const styleOf = (line: string, text: string) =>
  scan(line).find((x) => x.text === text)?.style;

describe("the faust tokeniser", () => {
  it("knows the composition operators, which ARE the language", () => {
    // Longest first: `<:` and `:>` must not be read as a `:` followed by an angle bracket.
    expect(styleOf("a <: b", "<:")).toBe("operator");
    expect(styleOf("a :> b", ":>")).toBe("operator");
    expect(styleOf("a : b", ":")).toBe("operator");
    expect(styleOf("a ~ b", "~")).toBe("operator");
  });

  it("knows the signal operators a diagram is drawn with", () => {
    for (const op of ["@", "!", "_", "'"])
      expect(styleOf(`x ${op} y`, op), op).toBe("operator");
  });

  it("reads a lone `_` as the wire, and `_foo` as a name", () => {
    // Found by this test: the identifier rule swallowed `_`, so every `process = _, _` drew as a variable.
    expect(styles("process = _, _")).toEqual([
      "keyword",
      "operator",
      "operator",
      "operator",
      "operator",
    ]);
    expect(styleOf("_gain = 1", "_gain")).toBe("variableName");
  });

  it("tells a library's namespace from a local name", () => {
    // `os.osc` — the prefix is stdfaust, the member is not. Knowing which is the whole point.
    expect(
      scan("os.osc(440)")
        .slice(0, 3)
        .map((x) => x.style),
    ).toEqual(["namespace", "punctuation", "variableName"]);
    // …and a bare two-letter name with no dot after it is just a name.
    expect(styleOf("os = 1", "os")).toBe("variableName");
  });

  it("gives the UI primitives their own colour", () => {
    // They declare the module's parameters, and nothing checks that `module.k7x` agrees with them.
    expect(styleOf('hslider("Cutoff", 1200, 20, 20000, 1)', "hslider")).toBe(
      "macroName",
    );
    expect(styleOf('button("gate")', "button")).toBe("macroName");
    expect(styleOf("process = _", "process")).toBe("keyword");
  });

  it("reads numbers, including the ones with a leading dot", () => {
    expect(styleOf("x = 0.933033", "0.933033")).toBe("number");
    expect(styleOf("x = .5", ".5")).toBe("number");
    expect(styleOf("x = 1e-3", "1e-3")).toBe("number");
  });

  it("stops an unterminated string at the end of the line", () => {
    // Typing an opening quote must not turn the rest of the file into a string.
    const out = scan('a = "unclosed');
    expect(out.at(-1)).toEqual({ text: '"unclosed', style: "string" });
    // The NEXT line is unaffected: nothing about a string crosses one.
    expect(styles("process = _")).toEqual(["keyword", "operator", "operator"]);
  });

  it("carries a block comment across lines, and only until it closes", () => {
    const state = faustStartState();
    expect(scan("/* the tine", state).map((x) => x.style)).toEqual(["comment"]);
    expect(state.block).toBe(true);
    expect(scan("still inside", state).map((x) => x.style)).toEqual([
      "comment",
    ]);
    expect(scan("closes here */ process", state).map((x) => x.style)).toEqual([
      "comment",
      "keyword",
    ]);
    expect(state.block).toBe(false);
  });

  it("closes a one-line block comment without arming the state", () => {
    const state = faustStartState();
    expect(scan("/* short */ process", state).map((x) => x.style)).toEqual([
      "comment",
      "keyword",
    ]);
    expect(state.block).toBe(false);
  });

  it("returns only names CodeMirror knows", () => {
    // A typo in a style name costs the colour and warns to a console nobody is watching.
    const real = tags as unknown as Record<string, unknown>;
    const source = [
      'import("stdfaust.lib");',
      "// the wurlitzer",
      'cutoff = hslider("Cutoff", 1200, 20, 20000, 1) : si.smoo;',
      "process = par(i, 2, ve.moog_vcf(res, cutoff)) <: _, _;",
      "tz(x) = 2.0 * (x - x@2);",
      "/* a block */",
    ];
    const state = faustStartState();
    const seen = new Set(
      source.flatMap((l) => scan(l, state)).map((x) => x.style),
    );
    expect(seen.size).toBeGreaterThan(5);
    for (const name of seen) expect(real[name], name).toBeDefined();
  });
});
