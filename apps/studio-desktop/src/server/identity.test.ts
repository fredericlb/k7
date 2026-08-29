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
  JSON.parse(readFileSync(join(home, "engine-tray.json"), "utf8"));
const root = (slug: string) => join(home, "root", slug);
const seed = (slug: string) => {
  mkdirSync(join(root(slug), "Examples"), { recursive: true });
  writeFileSync(join(root(slug), "Examples", "a.st0"), "x", "utf8");
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
  it("takes the workspaces with it — otherwise they simply stop being listed", async () => {
    const { adoptIdentity, currentIdentity } = await mod();
    const local = currentIdentity();
    seed(local.replace(/[^a-zA-Z0-9]/g, "_"));

    expect(adoptIdentity("fred@parapluie.org")).toEqual({ moved: true });

    const to = root("fred_parapluie_org");
    expect(existsSync(join(to, "Examples", "a.st0"))).toBe(true);
    expect(existsSync(root(local.replace(/[^a-zA-Z0-9]/g, "_")))).toBe(false);
    expect(settings().identity).toBe("fred@parapluie.org");
  });

  it("leaves BOTH alone when both exist — merging two real roots is a decision, not a migration", async () => {
    const { adoptIdentity, currentIdentity } = await mod();
    const local = currentIdentity();
    const from = local.replace(/[^a-zA-Z0-9]/g, "_");
    seed(from);
    seed("fred_parapluie_org");

    expect(adoptIdentity("fred@parapluie.org")).toEqual({ moved: false });
    expect(existsSync(join(root(from), "Examples", "a.st0"))).toBe(true);
    expect(
      existsSync(join(root("fred_parapluie_org"), "Examples", "a.st0")),
    ).toBe(true);
    // The identity still changes: the user asked for it, and nothing was lost.
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
