// The failure this file exists for has no error message: pair a server, the identity becomes
// the account's email, the slug changes, and `listWorkspaces` bootstraps a fresh empty
// `Examples` under the new one. The user reads that as "my songs are gone".

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let home: string;
const saved = process.env.STUDIO_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "desk-id-"));
  process.env.STUDIO_HOME = home;
  vi.resetModules();
});

afterEach(() => {
  if (saved === undefined) delete process.env.STUDIO_HOME;
  else process.env.STUDIO_HOME = saved;
  rmSync(home, { recursive: true, force: true });
});

const mod = () => import("./identity.ts");
const settings = () =>
  JSON.parse(readFileSync(join(home, "engine-host.json"), "utf8"));
/** The workspaces root: ONE level, with no slug under it — packages/engine-client/docs/paths.md. */
const root = () => join(home, "workspace");
const seed = () => {
  mkdirSync(join(root(), "Examples"), { recursive: true });
  writeFileSync(join(root(), "Examples", "a.st0"), "x", "utf8");
};

describe("the machine's identity", () => {
  it("chooses one on first launch and REMEMBERS it", async () => {
    const { currentIdentity } = await mod();
    const first = currentIdentity();
    expect(first).toMatch(/@localhost$/);
    expect(settings().identity).toBe(first);
    // A second call must not re-derive: the slug is a directory name.
    expect(currentIdentity()).toBe(first);
  });

  it("shapes it like an email, because the slug rule expects one", async () => {
    const { currentIdentity } = await mod();
    expect(currentIdentity()).toContain("@");
  });

  it("answers a user AuthGate accepts without a sign-in card", async () => {
    const { asUser } = await mod();
    const u = asUser("fred@example.com");
    expect(u).toEqual({
      sub: "fred@example.com",
      name: "fred",
      email: "fred@example.com",
      groups: [],
    });
  });
});

describe("adopting a server's identity", () => {
  // What this used to guard: the workspaces lived under `root/<slug>`, so adopting an identity
  // renamed the directory or the machine read as empty. There is no slug in the tree now, and
  // the assertion that matters is that the SAME workspaces are still there afterwards.
  it("leaves the workspaces exactly where they were", async () => {
    const { adoptIdentity, currentIdentity } = await mod();
    currentIdentity();
    seed();

    expect(adoptIdentity("fred@parapluie.org")).toEqual({ moved: false });

    expect(existsSync(join(root(), "Examples", "a.st0"))).toBe(true);
    expect(settings().identity).toBe("fred@parapluie.org");
  });

  it("is a no-op when the identity is unchanged", async () => {
    const { adoptIdentity, currentIdentity } = await mod();
    const local = currentIdentity();
    expect(adoptIdentity(local)).toEqual({ moved: false });
  });

  it("still adopts when there is nothing to move — a fresh machine", async () => {
    const { adoptIdentity, currentIdentity } = await mod();
    currentIdentity();
    expect(adoptIdentity("fred@parapluie.org")).toEqual({ moved: false });
    expect(settings().identity).toBe("fred@parapluie.org");
  });
});
