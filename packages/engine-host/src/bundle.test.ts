import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { fileServiceRuntime, setRepoRoot } from "./bundle.ts";

// The checkout tier only: the packaged one needs a staged bundle, which no unit test can conjure.
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const entry = (path: string): (() => void) => {
  const was = process.argv[1];
  process.argv[1] = path;
  return () => {
    process.argv[1] = was;
  };
};

afterEach(() => {
  setRepoRoot(null);
});

describe("fileServiceRuntime, checkout tier", () => {
  it("runs the repo's server.ts under our own interpreter and flags", () => {
    const restore = entry("/anywhere/cli.ts");
    setRepoRoot(REPO);
    const r = fileServiceRuntime();
    restore();
    expect(r?.node).toBe(process.execPath);
    expect(r?.args.at(-1)).toBe(
      join(REPO, "packages", "file-service", "src", "server.ts"),
    );
    // Whatever taught US to read TypeScript is handed down verbatim — under a type-stripping node, nothing.
    expect(r?.args.slice(0, -1)).toEqual(process.execArgv);
  });

  it("refuses when our entry is not TypeScript", () => {
    const restore = entry("/staged/engine-cli.mjs");
    setRepoRoot(REPO);
    const r = fileServiceRuntime();
    restore();
    expect(r).toBeNull();
  });

  it("refuses when the root holds no file service", () => {
    const restore = entry("/anywhere/cli.ts");
    setRepoRoot(join(REPO, "packages"));
    const r = fileServiceRuntime();
    restore();
    expect(r).toBeNull();
  });
});
