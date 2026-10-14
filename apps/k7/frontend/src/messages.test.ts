import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The two catalogues are one document in two languages: a key in one and not the other is a
// screen that falls back to its own name, and nothing else in the build says so.

const here = dirname(fileURLToPath(import.meta.url));
const read = (locale: string): Record<string, string> =>
  JSON.parse(
    readFileSync(join(here, "..", "messages", `${locale}.json`), "utf8"),
  );

const en = read("en");
const fr = read("fr");
const keys = (d: Record<string, string>) =>
  Object.keys(d).filter((k) => k !== "$schema");
/** The named holes a message states — a SET, since a language may use one twice for agreement. */
const holes = (s: string) =>
  [
    ...new Set([...s.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((m) => m[1])),
  ].sort();

describe("the message catalogues", () => {
  it("name the same keys", () => {
    expect(keys(fr)).toEqual(keys(en));
  });

  it("ask for the same PARAMETERS in each language", () => {
    // A hole in one and not the other is a caller that compiles and a sentence with `{name}` in it.
    for (const k of keys(en)) expect(holes(fr[k]), k).toEqual(holes(en[k]));
  });

  it("leaves no message empty", () => {
    for (const k of keys(en)) {
      expect(en[k].trim(), k).not.toBe("");
      expect(fr[k].trim(), k).not.toBe("");
    }
  });
});
