// librariesRoutes.test.ts — the hub's `/account/libraries`: an admin's list comes with every draft
// made, so the Libraries page can publish before any project was opened. See docs/fileHub.md.

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it } from "vitest";
import { LibraryStore } from "./libraries.ts";
import { librariesRoute } from "./librariesRoutes.ts";

let store: LibraryStore;

beforeEach(() => {
  const tmp = mkdtempSync(join(tmpdir(), "hub-lib-routes-"));
  const seed = join(tmp, "seed");
  mkdirSync(join(seed, "k7-core", "modules"), { recursive: true });
  writeFileSync(join(seed, "k7-core", "modules", "mix.k7x"), "x(1)\n");
  store = new LibraryStore(join(tmp, "data"), seed);
});

/** One request through the route, its body already parsed as a parser in front would leave it. */
async function ask(
  method: string,
  path: string,
  admin: boolean,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const out = { status: 200, body: {} as Record<string, unknown> };
  const req = { method, path, readableEnded: true, body: {} } as Request;
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: Record<string, unknown>) {
      out.body = body;
      return res;
    },
  } as unknown as Response;
  await librariesRoute(store, req, res, admin, () => {});
  return out;
}

const draft = () => join(store.home, "k7-core", "draft");

describe("the hub's libraries routes", () => {
  it("gives an admin's list its drafts, so a publish is offered before any project opened", async () => {
    const r = await ask("GET", "/account/libraries", true);
    expect(r.body.libraries).toMatchObject([{ name: "k7-core", draft: true }]);
    expect(existsSync(join(draft(), "modules", "mix.k7x"))).toBe(true);
    const published = await ask(
      "POST",
      "/account/libraries/k7-core/publish",
      true,
    );
    expect(published.status).toBe(200);
    expect(store.versions("k7-core").map((v) => v.version)).toEqual([1, 2]);
  });

  it("makes no draft for anyone else, and refuses them the publish", async () => {
    const r = await ask("GET", "/account/libraries", false);
    expect(r.body.libraries).toMatchObject([{ name: "k7-core", draft: false }]);
    expect(existsSync(draft())).toBe(false);
    const published = await ask(
      "POST",
      "/account/libraries/k7-core/publish",
      false,
    );
    expect(published.status).toBe(403);
  });
});
