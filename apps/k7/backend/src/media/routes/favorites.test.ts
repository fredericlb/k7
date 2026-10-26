import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prefsStore } from "@studio/user-prefs";
import express, { type RequestHandler } from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEVICE_FAVORITES_ROUTE,
  type FavoriteStores,
  favoritesDeviceRouter,
  favoritesRouter,
  listOf,
  star,
} from "./favorites.ts";

let root: string;
let servers: Server[] = [];

const listen = (app: express.Express): Promise<string> =>
  new Promise((ok) => {
    const s = app.listen(0, () =>
      ok(`http://127.0.0.1:${(s.address() as { port: number }).port}`),
    );
    servers.push(s);
  });

const storesAt = (dir: string) =>
  ({
    own: prefsStore(join(dir, "favorites")),
    prefs: prefsStore<{ favorites?: string[] }>(dir),
  }) satisfies FavoriteStores;

// The device gate's stand-in: `Bearer <person>` names the person, `Bearer -` names nobody.
const gate: RequestHandler = (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  if (!token) return void res.status(401).end();
  res.locals.syncCaller = {
    slug: "acct",
    person: token === "-" ? null : token,
  };
  next();
};

/** A backend whose session is `sub`, paired with `server` when given. */
async function backend(
  s: FavoriteStores,
  sub: string,
  server?: { base: string; token: string },
): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { user?: { sub: string } }).user = { sub };
    next();
  });
  app.use(DEVICE_FAVORITES_ROUTE, favoritesDeviceRouter(gate, s));
  app.use(
    "/api/favorites",
    favoritesRouter(s, () => server ?? null),
  );
  return listen(app);
}

const post = (url: string, paths: string[], favorite: boolean) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paths, favorite }),
  });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "favorites-"));
});

afterEach(() => {
  for (const s of servers) s.close();
  servers = [];
  rmSync(root, { recursive: true, force: true });
});

describe("the practice list", () => {
  it("is a list of its own, under its own name, never seeded from the favorites", async () => {
    const fav = storesAt(root);
    fav.prefs.write("u", { favorites: ["songs/F"] });
    const practice: FavoriteStores = {
      own: prefsStore(join(root, "practice")),
      prefs: fav.prefs,
      key: "practice",
    };
    expect(listOf(practice, "u")).toEqual([]);
    expect(star(practice, "u", { paths: ["songs/P"], favorite: true })).toEqual(
      ["songs/P"],
    );
    expect(listOf(fav, "u")).toEqual(["songs/F"]);

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as { user?: { sub: string } }).user = { sub: "u" };
      next();
    });
    app.use(
      "/api/practice",
      favoritesRouter(practice, () => null),
    );
    const base = await listen(app);
    expect(await (await fetch(`${base}/api/practice`)).json()).toEqual({
      practice: ["songs/P"],
    });
  });
});

describe("the store", () => {
  it("seeds from the preferences, then keeps its own list", () => {
    const s = storesAt(root);
    s.prefs.write("u", { favorites: ["songs/A"] });
    expect(listOf(s, "u")).toEqual(["songs/A"]);
    expect(star(s, "u", { paths: ["songs/B"], favorite: true })).toEqual([
      "songs/A",
      "songs/B",
    ]);
    // The preferences' field is ignored from then on, whatever a wholesale save puts back there.
    s.prefs.write("u", { favorites: ["songs/Z"] });
    expect(listOf(s, "u")).toEqual(["songs/A", "songs/B"]);
  });

  it("sets a state, so starring twice keeps one star", () => {
    const s = storesAt(root);
    star(s, "u", { paths: ["songs/A"], favorite: true });
    star(s, "u", { paths: ["songs/A"], favorite: true });
    expect(star(s, "u", { paths: ["songs/A"], favorite: false })).toEqual([]);
  });
});

describe("the routes", () => {
  it("an unpaired backend answers from its own store", async () => {
    const base = await backend(storesAt(root), "u");
    await post(`${base}/api/favorites`, ["songs/A/Album"], true);
    const got = await (await fetch(`${base}/api/favorites`)).json();
    expect(got).toEqual({ favorites: ["songs/A/Album"] });
    expect((await post(`${base}/api/favorites`, [], true)).status).toBe(400);
  });

  it("the device door refuses a token that names nobody", async () => {
    const base = await backend(storesAt(root), "u");
    const res = await fetch(`${base}${DEVICE_FAVORITES_ROUTE}`, {
      headers: { authorization: "Bearer -" },
    });
    expect(res.status).toBe(403);
  });

  it("a paired machine reads and writes the server's list, after pushing its own once", async () => {
    const server = storesAt(join(root, "server"));
    star(server, "person", { paths: ["songs/S"], favorite: true });
    const serverBase = await backend(server, "nobody");
    const machine = storesAt(join(root, "machine"));
    star(machine, "local", { paths: ["songs/M"], favorite: true });
    const base = await backend(machine, "local", {
      base: serverBase,
      token: "person",
    });

    const first = await (await fetch(`${base}/api/favorites`)).json();
    expect(first).toEqual({ favorites: ["songs/M", "songs/S"] });
    expect(listOf(machine, "local")).toEqual([]);

    await post(`${base}/api/favorites`, ["songs/S"], false);
    expect(listOf(server, "person")).toEqual(["songs/M"]);
  });

  it("a server out of reach is an error, not a local list", async () => {
    const base = await backend(storesAt(root), "u", {
      base: "http://127.0.0.1:1",
      token: "person",
    });
    expect((await fetch(`${base}/api/favorites`)).status).toBe(502);
  });
});
