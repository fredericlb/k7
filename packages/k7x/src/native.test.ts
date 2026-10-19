// native.test.ts — the Rust reader answers what parse.ts answers, on every corpus file and every edge, or declines.
// A reader would get wrong that equal means JSON-equal: -0, Infinity and key order are compared as JS values.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rustSourceHash } from "../scripts/rustSources.mjs";
import { toJS } from "./ast.ts";
import { SOURCES } from "./k7xWasm.generated.ts";
import { nativeData, nativeReady } from "./native.ts";
import { K7SyntaxError, parseTree } from "./parse.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) return walk(abs);
    return name.endsWith(".k7x") ? [abs] : [];
  });
const corpus = ["demos", "k7-core"]
  .map((d) => join(ROOT, d))
  .filter(existsSync)
  .flatMap(walk);

function js(text: string): unknown {
  try {
    return toJS(parseTree(text));
  } catch (e) {
    return e;
  }
}

function rust(text: string): unknown {
  try {
    return nativeData(text);
  } catch (e) {
    return e;
  }
}

function same(text: string): void {
  const want = js(text);
  const got = rust(text);
  if (want instanceof K7SyntaxError) {
    expect(got).toBeInstanceOf(K7SyntaxError);
    const e = got as K7SyntaxError;
    expect([e.message, e.offset, e.line, e.column]).toEqual([
      want.message,
      want.offset,
      want.line,
      want.column,
    ]);
  } else {
    expect(got).toEqual(want);
    expect(Object.keys(got as object)).toEqual(Object.keys(want as object));
  }
}

describe("the Rust reader", () => {
  it("is built from the Rust sources as they are", () => {
    expect(rustSourceHash(), "re-run npm run build:wasm -w @studio/k7x").toBe(
      SOURCES,
    );
  });

  it("runs here", async () => {
    expect(await nativeReady()).toBe(true);
    expect(nativeData("a(1)")).toEqual({ a: 1 });
  });

  it.each([
    [
      "numbers",
      "a(-0) b(1e999) c(-1e999) d(0.1) e(1e21) f(123456789012345678) g(5e-324)",
    ],
    [
      "keys a JS object reorders",
      'a({ "2": 1, b: 2, "1": 3, "__proto__": 4 })',
    ],
    [
      "escapes",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a k7x raw string keeps ${…} as text, which is what this checks.
      'a("\\n\\t\\u00e9\\ud83d\\ude00\\\\\\"\\/\\0") b(`x\\`y\\\\z${1}`)',
    ],
    ["text past the BMP", 'a("é 😀 —") "clé 😀"(1)'],
    ["a byte-order mark", "﻿a(1)"],
    ["an empty file", ""],
    ["comments", "/* x */ a(1) // y\n.b([1, /* z */ 2,])"],
  ])("%s", (_, text) => same(text));

  it.each([
    "a(1",
    'a("x',
    "a(foo)",
    "a(1) a(2)",
    "a({ b: 1, b: 2 })",
    "a(-)",
    "a([1, 2)",
    "a(`x",
    "/* x",
    'a("\\q")',
    'a("\\u12")',
    "é(1)",
    'a("é")\nb(\n  😀bare)',
    `a(${"[".repeat(300)}${"]".repeat(300)})`,
  ])("refuses %s as parse.ts does", (text) => same(text));

  it("declines what a Rust string cannot hold, so parse.ts answers it", () => {
    expect(nativeData('a("\\ud800")')).toBeUndefined();
    expect(nativeData('a("\ud800")')).toBeUndefined();
  });

  it(`reads every corpus file as parse.ts does (${corpus.length})`, () => {
    for (const file of corpus) same(readFileSync(file, "utf8"));
  });
});
