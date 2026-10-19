// parseStore.test.ts — a settled parse outlives the process that made it, and only for the bundle that made it.

import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flush, resetParseStore } from "./parseStore";
import { clearYamlCache, settledParse } from "./yamlCache";

describe("the parse store", () => {
  let home: string;
  let bundle: string;
  let file: string;
  const argv1 = process.argv[1];
  const saved = { ...process.env };
  const old = (path: string) =>
    utimesSync(path, new Date(1e12), new Date(1e12));
  /** A new process: nothing in memory, the store file read again. */
  const restart = () => {
    clearYamlCache();
    resetParseStore();
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "parse-store-"));
    bundle = join(home, "file-service.mjs");
    writeFileSync(bundle, "// the bundle");
    file = join(home, "module.yaml");
    writeFileSync(file, "a: 1\n");
    old(file);
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

  it("serves a settled parse from disk after a restart", () => {
    expect(settledParse(file, "t", parse)).toEqual({ text: "a: 1\n" });
    flush();
    restart();
    expect(settledParse(file, "t", refuse)).toEqual({ text: "a: 1\n" });
  });

  it("parses again a file that changed", () => {
    settledParse(file, "t", parse);
    flush();
    restart();
    writeFileSync(file, "a: 22\n");
    old(file);
    utimesSync(file, new Date(1.5e12), new Date(1.5e12));
    expect(settledParse(file, "t", parse)).toEqual({ text: "a: 22\n" });
  });

  it("drops the store made by another bundle", () => {
    settledParse(file, "t", parse);
    flush();
    writeFileSync(bundle, "// the next release, a different size");
    restart();
    expect(() => settledParse(file, "t", refuse)).toThrow("parsed again");
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
