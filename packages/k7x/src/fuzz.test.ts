// fuzz.test.ts — random edits on random files, each checked against the same edit done on plain data.
// Seeded, so a failure replays: the three layouts are canonical, noisy (comments everywhere) and comma-first.

import { describe, expect, it } from "vitest";
import { K7Document } from "./edit.ts";
import { stringify } from "./print.ts";

type P = (string | number)[];
type Data = Record<string, unknown>;

let seed = 1;
const rnd = (): number => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const KEYS = ["a", "b", "c", "d-e", "x y", "é", "0", "t", "$k"];
const LEAVES = [
  1,
  -2.5,
  "s",
  "L".repeat(45),
  "é\u{1F600}",
  true,
  null,
  "",
  "a\nb",
];

function gen(depth: number): unknown {
  const r = rnd();
  if (depth <= 0 || r < 0.4) return pick<unknown>(LEAVES);
  if (r < 0.7)
    return Array.from({ length: Math.floor(rnd() * 4) }, () => gen(depth - 1));
  const o: Data = {};
  for (let i = Math.floor(rnd() * 4); i > 0; i--)
    o[pick(KEYS)] = gen(depth - 1);
  return o;
}

function genRoot(): Data {
  const o: Data = {};
  for (let i = Math.floor(rnd() * 5); i > 0; i--) o[pick(KEYS)] = gen(3);
  return o;
}

const noisy = (t: string): string =>
  t.replace(/,(?=[^"\n]*$)/gm, ", /* c */").replace(/\n/g, " // tail\n");

const commaFirst = (t: string): string =>
  t
    .replace(/,\n([ \t]*)/g, (_, ind) =>
      rnd() < 0.5 ? ` // c\n${ind}, ` : `\n${ind}// mid\n${ind}, `,
    )
    .replace(/,(\s*[\]}])/g, "$1");

/** The file for `data` in one layout, or null when the layout's rewrite changed what it reads as. */
function layout(data: Data, kind: string): string | null {
  const src = stringify(data);
  if (kind === "canonical") return src;
  const out = kind === "noisy" ? noisy(src) : commaFirst(src);
  const doc = new K7Document(out);
  if (!doc.contents) return null;
  return JSON.stringify(doc.toJS()) === JSON.stringify(data) ? out : null;
}

const replay = (doc: K7Document, orig: string): string =>
  doc.changes.reduce(
    (t, c) => t.slice(0, c.start) + c.insert + t.slice(c.end),
    orig,
  );

function paths(v: unknown, p: P = []): P[] {
  const out = [p];
  if (Array.isArray(v))
    for (const [i, x] of v.entries()) out.push(...paths(x, [...p, i]));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) out.push(...paths(x, [...p, k]));
  return out;
}

function setPlain(o: unknown, p: P, v: unknown): unknown {
  if (!p.length) return v;
  const [h, ...r] = p;
  const c: Data | unknown[] = Array.isArray(o) ? [...o] : { ...(o as Data) };
  (c as Data)[h] = setPlain((c as Data)[h], r, v);
  return c;
}

const getPlain = (o: unknown, p: P): unknown =>
  p.reduce<unknown>((a, s) => (a as Data)?.[s], o);

/** One random edit, done on the document and on the plain data; the new data, or undefined when it skipped. */
function step(doc: K7Document, model: unknown): unknown {
  const all = paths(model).filter((p) => p.length > 0);
  if (!all.length) return undefined;
  const p = pick(all);
  const up = p.slice(0, -1);
  const parent = getPlain(model, up);
  const last = p[p.length - 1];
  const op = Math.floor(rnd() * 6);
  if (op === 0) {
    const v = gen(2);
    doc.setIn(p, v);
    return setPlain(model, p, v);
  }
  if (op === 1) {
    doc.deleteIn(p);
    if (Array.isArray(parent))
      return setPlain(
        model,
        up,
        parent.filter((_, i) => i !== last),
      );
    const { [last]: _gone, ...rest } = parent as Data;
    return setPlain(model, up, rest);
  }
  if (op === 2 && Array.isArray(parent)) {
    const v = gen(2);
    doc.insertIn(up, last as number, v);
    const c = [...parent];
    c.splice(last as number, 0, v);
    return setPlain(model, up, c);
  }
  if (op === 3 && Array.isArray(parent)) {
    const to = Math.floor(rnd() * parent.length);
    doc.moveIn(up, last as number, to);
    const c = [...parent];
    const [moved] = c.splice(last as number, 1);
    c.splice(to, 0, moved);
    return setPlain(model, up, c);
  }
  if (op === 4 && !Array.isArray(parent)) {
    const nk = `${String(last)}_r`;
    if (Object.hasOwn(parent as Data, nk)) return undefined;
    doc.renameKey(p, nk);
    const c: Data = {};
    for (const [k, v] of Object.entries(parent as Data))
      c[k === last ? nk : k] = v;
    return setPlain(model, up, c);
  }
  const cur = getPlain(model, p);
  if (op === 5 && Array.isArray(cur)) {
    const v = gen(2);
    doc.addIn(p, v);
    return setPlain(model, p, [...cur, v]);
  }
  return undefined;
}

describe("random path edits", () => {
  for (const kind of ["canonical", "noisy", "comma-first"]) {
    it(`give the data the same edits give, on a ${kind} file`, () => {
      seed = 7 + kind.length;
      for (let n = 0; n < 2000; n++) {
        const before = genRoot();
        const src = layout(before, kind);
        if (src === null) continue;
        const doc = new K7Document(src);
        let model: unknown = before;
        for (let k = 0; k < 4; k++) {
          const at = doc.toString();
          try {
            model = step(doc, model) ?? model;
          } catch (e) {
            throw new Error(`${(e as Error).message}\n${at}`);
          }
          expect(doc.toJS(), at).toEqual(model);
        }
        expect(replay(doc, src)).toBe(doc.toString());
      }
    });
  }

  it("turn one file's data into another's with applyIn", () => {
    seed = 42;
    for (let n = 0; n < 2000; n++) {
      const before = genRoot();
      const src = layout(before, pick(["canonical", "noisy", "comma-first"]));
      if (src === null) continue;
      const after = genRoot();
      const doc = new K7Document(src);
      doc.applyIn([], after);
      expect(doc.toJS(), src).toEqual(after);
      expect(replay(doc, src)).toBe(doc.toString());
    }
  });
});
