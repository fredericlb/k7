// `scripts/tokens.mjs` mints the token k7 calls the médiathèque with, and it re-implements the
// token scheme to do it — a plain node script has no TypeScript loader, and booting tsx to sign
// 100 bytes buys nothing. So the one thing that can rot silently is the pair drifting apart,
// which would surface days later as a service refused for no visible reason. Here because this
// package owns the consumer half: `MEDIATEK_TOKEN` in env.yaml.

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
import { createApiTokens } from "@frediverse/oidc";
import { localServiceUrl } from "@studio/web-protocol/services";
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

const k7Token = (): string =>
  parse(readFileSync(envFile, "utf8"))["k7-backend"].MEDIATEK_TOKEN;

const secretIn = (file: string): string =>
  (parse(readFileSync(file, "utf8"))?.["pl8-backend"] ?? {}).API_TOKEN_SECRET;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "studio-tokens-"));
  envFile = join(home, "env.yaml");
  copyFileSync(join(repo, "env.example.yaml"), envFile);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("the tokens script", () => {
  it("mints one the médiathèque's own verifier accepts", () => {
    run();
    // The real scheme, from the package the backend itself calls — that is the whole test.
    expect(createApiTokens(secretIn(envFile)).verify(k7Token())).toBe(
      "service:k7",
    );
  });

  it("generates the signing secret when the service has none", () => {
    // Left empty, the backend falls back to the session secret, so rotating that would log everyone out AND revoke every machine's sync.
    expect(secretIn(join(repo, "env.example.yaml"))).toBe("");
    run();
    expect(secretIn(envFile)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("writes k7's loopback URL, since a checkout cannot use the fixed one", () => {
    // The address is fixed in code, and a CHECKOUT is the exception: the public name goes out to the LAN proxy and straight back for nothing.
    run();
    // Against the table, not a literal: the script carries its own copy of the port, and this is what stops the two from drifting.
    expect(
      parse(readFileSync(envFile, "utf8"))["k7-backend"].MEDIATEK_URL,
    ).toBe(localServiceUrl("pl8"));
  });

  it("never overwrites a URL somebody set on purpose", () => {
    writeFileSync(
      envFile,
      readFileSync(envFile, "utf8").replace(
        /^k7-backend:$/m,
        'k7-backend:\n  MEDIATEK_URL: "http://elsewhere:9000"',
      ),
      "utf8",
    );
    run();
    expect(
      parse(readFileSync(envFile, "utf8"))["k7-backend"].MEDIATEK_URL,
    ).toBe("http://elsewhere:9000");
  });

  it("leaves a working token alone", () => {
    run();
    const first = k7Token();
    expect(run()).toContain("already valid");
    expect(k7Token()).toBe(first);
  });

  it("re-mints on --force, and the new one verifies too", () => {
    run();
    const first = k7Token();
    run("--force");
    expect(k7Token()).not.toBe(first);
    expect(createApiTokens(secretIn(envFile)).verify(k7Token())).toBe(
      "service:k7",
    );
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
