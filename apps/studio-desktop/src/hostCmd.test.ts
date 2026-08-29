// The check that cannot be inferred from a green run: --use-system-ca must be the FIRST
// argv on both node tiers. Miss it, or put it after the script where node treats it as a
// script argument, and everything works against a public registry while a private-CA host
// fails the TLS handshake silently and the engine never appears in that UI's picker.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Packaging, resolve } from "./hostCmd.ts";

const NOT_PACKAGED: Packaging = { packaged: false, resourcesPath: "/nowhere" };

let dir: string;
const savedCmd = process.env.STUDIO_ENGINE_HOST_CMD;
const savedRoot = process.env.STUDIO_REPO_ROOT;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "capot-host-"));
  delete process.env.STUDIO_ENGINE_HOST_CMD;
});

afterEach(() => {
  for (const [k, v] of [
    ["STUDIO_ENGINE_HOST_CMD", savedCmd],
    ["STUDIO_REPO_ROOT", savedRoot],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});

/** A tree shaped like the repo: the walk looks for engine/moteur, tsx and the supervisor entry. */
function fakeRepo(): string {
  mkdirSync(join(dir, "engine", "moteur"), { recursive: true });
  mkdirSync(join(dir, "node_modules", "tsx", "dist"), { recursive: true });
  mkdirSync(join(dir, "packages", "engine-host", "src"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "tsx", "dist", "cli.mjs"), "");
  writeFileSync(join(dir, "packages", "engine-host", "src", "main.ts"), "");
  return dir;
}

/** A packaged layout: node and engine-host.mjs FLAT siblings, as electron-builder stages them. */
function fakeBundle(): Packaging {
  const exe = process.platform === "win32" ? "node.exe" : "node";
  writeFileSync(join(dir, exe), "");
  writeFileSync(join(dir, "engine-host.mjs"), "");
  return { packaged: true, resourcesPath: dir };
}

describe("resolving the supervisor", () => {
  it("puts --use-system-ca first on the packaged tier", () => {
    const cmd = resolve(fakeBundle());
    expect(cmd?.args[0]).toBe("--use-system-ca");
    expect(cmd?.args[1]).toMatch(/engine-host\.mjs$/);
  });

  it("puts --use-system-ca first on the dev tier, before tsx and the entry", () => {
    process.env.STUDIO_REPO_ROOT = fakeRepo();
    const cmd = resolve(NOT_PACKAGED);
    expect(cmd?.program).toBe("node");
    expect(cmd?.args[0]).toBe("--use-system-ca");
    expect(cmd?.args[1]).toMatch(/tsx[/\\]dist[/\\]cli\.mjs$/);
    expect(cmd?.args[2]).toMatch(/engine-host[/\\]src[/\\]main\.ts$/);
  });

  it("runs $STUDIO_ENGINE_HOST_CMD with NO arguments — a custom build brings its own", () => {
    const own = join(dir, "my-supervisor");
    writeFileSync(own, "");
    process.env.STUDIO_ENGINE_HOST_CMD = own;
    expect(resolve(NOT_PACKAGED)).toEqual({ program: own, args: [] });
  });

  it("ignores a $STUDIO_ENGINE_HOST_CMD that is not a file, rather than spawning nothing", () => {
    process.env.STUDIO_ENGINE_HOST_CMD = join(dir, "absent");
    process.env.STUDIO_REPO_ROOT = fakeRepo();
    expect(resolve(NOT_PACKAGED)?.program).toBe("node");
  });

  it("ignores a half-staged bundle and falls through, rather than spawning a missing node", () => {
    writeFileSync(join(dir, "engine-host.mjs"), ""); // no vendored node beside it
    process.env.STUDIO_REPO_ROOT = fakeRepo();
    const cmd = resolve({ packaged: true, resourcesPath: dir });
    expect(cmd?.program).toBe("node");
  });

  it("answers null when there is neither a bundle nor a repo — the LOUD case", () => {
    process.env.STUDIO_REPO_ROOT = dir; // exists, but holds no engine/moteur
    expect(resolve(NOT_PACKAGED)).toBeNull();
  });
});
