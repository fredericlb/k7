// parseStore.test.ts — a parse outlives the process that made it, keyed by content, for the bundle that made
// it; and the bundle's own store answers a first launch.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flush, parseKey, resetParseStore, SEED_FILE } from "./parseStore";
import { clearYamlCache, settledParse } from "./yamlCache";

describe("the parse store", () => {
  let home: string;
  let bundle: string;
  let file: string;
  const argv1 = process.argv[1];
  const saved = { ...process.env };
  /** A new process: nothing in memory, the store files read again. */
  const restart = () => {
    clearYamlCache();
    resetParseStore();
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "parse-store-"));
    mkdirSync(join(home, "bin"));
    bundle = join(home, "bin", "file-service.mjs");
    writeFileSync(bundle, "// the bundle");
    file = join(home, "module.k7x");
    writeFileSync(file, "a(1)\n");
    process.env.STUDIO_HOME = home;
    process.env.STUDIO_PARSE_CACHE = "1";
    process.argv[1] = bundle;
    restart();
  });
  afterEach(() => {
    process.argv[1] = argv1;
    process.env = { ...saved };
    restart();
  });

  const parse = (text: string) => ({ text });
  const refuse = () => {
    throw new Error("parsed again");
  };

  it("serves a parse from disk after a restart", () => {
    expect(settledParse(file, "t", parse)).toEqual({ text: "a(1)\n" });
    flush();
    restart();
    expect(settledParse(file, "t", refuse)).toEqual({ text: "a(1)\n" });
  });

  it("serves the same bytes at another path, as a library copied or synced", () => {
    settledParse(file, "t", parse);
    flush();
    restart();
    const copy = join(home, "copy.k7x");
    writeFileSync(copy, "a(1)\n");
    expect(settledParse(copy, "t", refuse)).toEqual({ text: "a(1)\n" });
  });

  it("parses again a file whose bytes changed", () => {
    settledParse(file, "t", parse);
    flush();
    restart();
    writeFileSync(file, "a(22)\n");
    expect(settledParse(file, "t", parse)).toEqual({ text: "a(22)\n" });
  });

  it("drops the account's store made by another bundle", () => {
    settledParse(file, "t", parse);
    flush();
    writeFileSync(bundle, "// the next release, a different size");
    restart();
    expect(() => settledParse(file, "t", refuse)).toThrow("parsed again");
  });

  it("answers a first launch from the bundle's own store", () => {
    const key = parseKey("t", file, "a(1)\n");
    writeFileSync(
      join(home, SEED_FILE),
      JSON.stringify({ code: "", entries: { [key]: { text: "seeded" } } }),
    );
    restart();
    expect(settledParse(file, "t", refuse)).toEqual({ text: "seeded" });
  });

  it("is off outside a bundle", () => {
    process.argv[1] = join(home, "server.ts");
    restart();
    settledParse(file, "t", parse);
    flush();
    restart();
    expect(() => settledParse(file, "t", refuse)).toThrow("parsed again");
  });
});
