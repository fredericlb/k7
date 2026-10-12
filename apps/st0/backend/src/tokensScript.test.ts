// `scripts/tokens.mjs` gives this backend its own API_TOKEN_SECRET in env.yaml. Here because this
// package is the one that signs with it. Each case runs the real script on a scratch env.yaml.

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const repo = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);
const script = join(repo, "scripts", "tokens.mjs");

let home: string;
let envFile: string;

/** The script against a scratch copy of env.yaml, so it writes nothing of the developer's. */
function run(...args: string[]): string {
  return execFileSync(process.execPath, [script, "--env", envFile, ...args], {
    cwd: repo,
    encoding: "utf8",
  });
}

const secretIn = (file: string): string =>
  parse(readFileSync(file, "utf8"))?.["st0-backend"]?.API_TOKEN_SECRET;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "studio-tokens-"));
  envFile = join(home, "env.yaml");
  copyFileSync(join(repo, "env.example.yaml"), envFile);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("the tokens script", () => {
  it("generates the signing secret when the service has none", () => {
    // Left empty, the backend falls back to the session secret, so rotating that would log everyone out AND revoke every token.
    expect(secretIn(join(repo, "env.example.yaml"))).toBe("");
    run();
    expect(secretIn(envFile)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("leaves a secret already there alone", () => {
    run();
    const first = secretIn(envFile);
    expect(run()).toContain("already set");
    expect(secretIn(envFile)).toBe(first);
  });

  it("never touches k7's own secret, whose tokens users keep in their settings", () => {
    writeFileSync(
      envFile,
      readFileSync(envFile, "utf8").replace(
        /^ {2}K7_API_TOKEN_SECRET: ""$/m,
        '  K7_API_TOKEN_SECRET: "kept"',
      ),
      "utf8",
    );
    run();
    expect(
      parse(readFileSync(envFile, "utf8"))["st0-backend"].K7_API_TOKEN_SECRET,
    ).toBe("kept");
  });

  it("writes nothing on --dry-run", () => {
    const before = readFileSync(envFile, "utf8");
    run("--dry-run");
    expect(readFileSync(envFile, "utf8")).toBe(before);
  });

  it("keeps env.yaml's comments", () => {
    // Hand-edited and heavily commented; a rewrite through JSON would flatten it.
    run();
    expect(readFileSync(envFile, "utf8")).toContain("# ");
  });
});
