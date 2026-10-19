// parse.ts — k7x text → the span-carrying tree of ast.ts.
// It looks like Strudel and is never evaluated: a call is a map entry, a chain a map, and nothing computes (docs/language.md).

import type {
  K7Entry,
  K7ListNode,
  K7MapNode,
  K7Node,
  K7ScalarNode,
} from "./ast.ts";

export class K7SyntaxError extends Error {
  constructor(
    message: string,
    readonly offset: number,
    readonly line: number,
    readonly column: number,
  ) {
    super(`${message} (${line}:${column})`);
    this.name = "K7SyntaxError";
  }
}

/** The 1-based line and column of an offset, the column in UTF-16 units: K7SyntaxError's convention. */
export function lineCol(
  text: string,
  offset: number,
): { line: number; col: number } {
  const before = text.slice(0, offset);
  return {
    line: before.split("\n").length,
    col: offset - before.lastIndexOf("\n"),
  };
}

const IDENT = /[A-Za-z_$][A-Za-z0-9_$-]*/y;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  "0": "\0",
  "\\": "\\",
  "/": "/",
  '"': '"',
  "'": "'",
};

/** How deep values may nest: far past any real file, and short of the stack a hostile one would exhaust. */
export const MAX_DEPTH = 256;

class Parser {
  pos = 0;
  depth = 0;
  constructor(readonly src: string) {}

  fail(message: string, at = this.pos): never {
    const { line, col } = lineCol(this.src, at);
    throw new K7SyntaxError(message, at, line, col);
  }

  /** Skips whitespace and both comment forms. */
  skip(): void {
    const s = this.src;
    for (;;) {
      const c = s[this.pos];
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "﻿")
        this.pos++;
      else if (c === "/" && s[this.pos + 1] === "/") {
        const nl = s.indexOf("\n", this.pos);
        this.pos = nl < 0 ? s.length : nl;
      } else if (c === "/" && s[this.pos + 1] === "*") {
        const close = s.indexOf("*/", this.pos + 2);
        if (close < 0) this.fail("unterminated comment");
        this.pos = close + 2;
      } else return;
    }
  }

  /** The offset of the next significant character, without moving. */
  peekPast(): number {
    const at = this.pos;
    this.skip();
    const next = this.pos;
    this.pos = at;
    return next;
  }

  root(): K7MapNode {
    const entries: K7Entry[] = [];
    const groups: [number, number][] = [];
    this.skip();
    while (this.pos < this.src.length) {
      if (this.src[this.pos] === ";") {
        this.pos++;
        this.skip();
        continue;
      }
      const first = entries.length;
      entries.push(...this.chain().entries);
      groups.push([first, entries.length]);
      this.skip();
    }
    checkUnique(entries, this);
    return {
      kind: "map",
      form: "root",
      entries,
      groups,
      start: 0,
      end: this.src.length,
    };
  }

  chain(): K7MapNode {
    const start = this.pos;
    const entries = [this.call(null)];
    while (this.src[this.peekPast()] === ".") {
      this.skip();
      const dot = this.pos++;
      this.skip();
      entries.push(this.call(dot));
    }
    checkUnique(entries, this);
    const end = entries[entries.length - 1].end;
    return { kind: "map", form: "chain", entries, groups: [], start, end };
  }

  call(dot: number | null): K7Entry {
    const keyStart = this.pos;
    const key = this.key();
    const keyEnd = this.pos;
    this.skip();
    if (this.src[this.pos] !== "(") this.fail(`expected "(" after ${key}`);
    const open = ++this.pos;
    const args: K7Node[] = [];
    this.skip();
    while (this.src[this.pos] !== ")") {
      args.push(this.value());
      this.skip();
      if (this.src[this.pos] === ",") {
        this.pos++;
        this.skip();
      } else if (this.src[this.pos] !== ")") this.fail('expected "," or ")"');
    }
    const close = this.pos++;
    let value: K7Node;
    if (args.length === 1) value = args[0];
    else if (args.length === 0)
      value = { kind: "scalar", value: true, start: open, end: open };
    else
      value = {
        kind: "list",
        form: "args",
        items: args,
        start: args[0].start,
        end: args[args.length - 1].end,
      } satisfies K7ListNode;
    return {
      key,
      value,
      start: dot ?? keyStart,
      end: close + 1,
      dot,
      keyStart,
      keyEnd,
    };
  }

  key(): string {
    const c = this.src[this.pos];
    if (c === '"' || c === "'") return this.quoted();
    IDENT.lastIndex = this.pos;
    const m = IDENT.exec(this.src);
    if (!m) this.fail("expected a key");
    this.pos += m[0].length;
    return m[0];
  }

  value(): K7Node {
    if (this.depth >= MAX_DEPTH) this.fail(`nested deeper than ${MAX_DEPTH}`);
    this.depth++;
    try {
      return this.valueAt();
    } finally {
      this.depth--;
    }
  }

  valueAt(): K7Node {
    const start = this.pos;
    const c = this.src[start];
    if (c === "[") return this.list();
    if (c === "{") return this.object();
    if (c === "`") return this.scalar(this.raw(), start);
    if (c === '"' || c === "'") {
      const s = this.quoted();
      if (this.src[this.peekPast()] !== "(") return this.scalar(s, start);
      this.pos = start;
      return this.chain();
    }
    if (c === "-" || (c >= "0" && c <= "9")) {
      NUMBER.lastIndex = start;
      const m = NUMBER.exec(this.src);
      if (!m) this.fail("malformed number");
      this.pos += m[0].length;
      return this.scalar(Number(m[0]), start);
    }
    IDENT.lastIndex = start;
    const m = IDENT.exec(this.src);
    if (!m) this.fail("expected a value");
    this.pos += m[0].length;
    if (this.src[this.peekPast()] === "(") {
      this.pos = start;
      return this.chain();
    }
    if (m[0] === "true") return this.scalar(true, start);
    if (m[0] === "false") return this.scalar(false, start);
    if (m[0] === "null") return this.scalar(null, start);
    return this.fail(
      `bare word "${m[0]}": quote a string, or call it as ${m[0]}(…)`,
      start,
    );
  }

  scalar(value: K7ScalarNode["value"], start: number): K7ScalarNode {
    return { kind: "scalar", value, start, end: this.pos };
  }

  list(): K7ListNode {
    const start = this.pos++;
    const items: K7Node[] = [];
    this.skip();
    while (this.src[this.pos] !== "]") {
      if (this.pos >= this.src.length) this.fail('unclosed "["', start);
      items.push(this.value());
      this.skip();
      if (this.src[this.pos] === ",") {
        this.pos++;
        this.skip();
      } else if (this.src[this.pos] !== "]") this.fail('expected "," or "]"');
    }
    this.pos++;
    return { kind: "list", form: "brackets", items, start, end: this.pos };
  }

  object(): K7MapNode {
    const start = this.pos++;
    const entries: K7Entry[] = [];
    this.skip();
    while (this.src[this.pos] !== "}") {
      if (this.pos >= this.src.length) this.fail('unclosed "{"', start);
      const keyStart = this.pos;
      const key = this.key();
      const keyEnd = this.pos;
      this.skip();
      if (this.src[this.pos] !== ":") this.fail(`expected ":" after ${key}`);
      this.pos++;
      this.skip();
      const value = this.value();
      entries.push({
        key,
        value,
        start: keyStart,
        end: value.end,
        dot: null,
        keyStart,
        keyEnd,
      });
      this.skip();
      if (this.src[this.pos] === ",") {
        this.pos++;
        this.skip();
      } else if (this.src[this.pos] !== "}") this.fail('expected "," or "}"');
    }
    this.pos++;
    checkUnique(entries, this);
    return {
      kind: "map",
      form: "object",
      entries,
      groups: [],
      start,
      end: this.pos,
    };
  }

  /** A "…" or '…' string, with JSON's escapes plus \'. */
  quoted(): string {
    const quote = this.src[this.pos];
    const start = this.pos++;
    let out = "";
    for (;;) {
      const c = this.src[this.pos++];
      if (c === undefined || c === "\n")
        this.fail("unterminated string", start);
      if (c === quote) return out;
      if (c !== "\\") {
        out += c;
        continue;
      }
      const e = this.src[this.pos++];
      if (e === "u") {
        const hex = this.src.slice(this.pos, this.pos + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex))
          this.fail("bad \\u escape", this.pos - 2);
        out += String.fromCharCode(Number.parseInt(hex, 16));
        this.pos += 4;
      } else if (e in ESCAPES) out += ESCAPES[e];
      else this.fail(`unknown escape \\${e}`, this.pos - 2);
    }
  }

  /** A `…` string: raw, multi-line, only \` and \\ escaped, and never interpolated. */
  raw(): string {
    const start = this.pos++;
    let out = "";
    for (;;) {
      const c = this.src[this.pos++];
      if (c === undefined) this.fail("unterminated string", start);
      if (c === "`") return out;
      const n = this.src[this.pos];
      if (c === "\\" && (n === "`" || n === "\\")) {
        out += n;
        this.pos++;
      } else out += c;
    }
  }
}

function checkUnique(entries: K7Entry[], p: Parser): void {
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.key)) p.fail(`duplicate key "${e.key}"`, e.keyStart);
    seen.add(e.key);
  }
}

/** The tree of a whole file; throws K7SyntaxError. An empty file is an empty map. */
export function parseTree(text: string): K7MapNode {
  return new Parser(text).root();
}

/** One value with nothing but trivia around it: what a writer's raw source must be; throws K7SyntaxError. */
export function parseValue(text: string): K7Node {
  const p = new Parser(text);
  p.skip();
  if (p.pos >= text.length) p.fail("expected a value");
  const value = p.value();
  p.skip();
  if (p.pos < text.length) p.fail("expected the end of the value");
  return value;
}
