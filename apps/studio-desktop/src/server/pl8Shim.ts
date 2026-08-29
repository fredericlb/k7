// pl8Shim.ts — pl8's routes, answered locally when no server is configured. The ONE rule:
// every one of them ANSWERS. A route that merely fails is not the same as a route that says
// no — `project-shell`'s gate runs its reachability probe on an unexpected throw, and that
// probe on a service which is plainly up always reports `blocked`, which draws the worst
// screen in the app ("this page isn't allowed to reach the engine", with a CORS story) on a
// machine where nothing is wrong. See ../../docs/pl8Shim.md.

import type { Express, Response } from "express";

/**
 * Constant, and that is the point: `Home` polls `/revision` and refetches when it MOVES. A
 * changing value would re-ask an empty register forever.
 */
const OFFLINE = "offline";

/** The shape both clients read an error out of — `{ error }`, with the status on the thrown Error. */
function say(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

/** Writes are refused, never faked: the register is pl8's, and a local copy would be a second one. */
const NO_SERVER =
  "no server is configured, so this belongs to nobody yet — set one in Settings";

/**
 * The catch-all answer, as a handler the REMOTE proxy can fall back to when the server cannot
 * be reached. Same body, so a paired machine that loses its network behaves exactly like one
 * that never had a server.
 */
export function pl8Offline(_req: unknown, res: Response): void {
  say(res, 503, NO_SERVER);
}

export function mountPl8Shim(app: Express): void {
  // ── the register ──────────────────────────────────────────────────────────

  // An EMPTY register is what makes the home page address its projects as `@local`:
  // `namedByRepo` needs the repo name to be registered, and none is.
  app.get("/pl8/api/projects", (_req, res) => {
    res.json({ repos: [], revision: OFFLINE });
  });
  app.get("/pl8/api/projects/revision", (_req, res) => {
    res.json({ revision: OFFLINE });
  });

  /**
   * `null` with a **200**, not a 404: "no library repository" is the ordinary state of a new
   * account, and the gate has a screen for it with no Retry. A 404 would be read as "pl8 is
   * broken" instead of "nobody has set one".
   */
  app.get("/pl8/api/projects/libraries", (_req, res) => {
    res.json({ libraries: null });
  });

  /**
   * 404 WITH A SENTENCE. The gate prints the server's own words on its `missing` screen
   * (`status === 400 || status === 404`), whose one button goes back to the home page — which
   * is exactly the right move when there is no register to resolve a name against.
   */
  app.get("/pl8/api/projects/by-name/:name", (req, res) => {
    say(
      res,
      404,
      `no server is configured, so the repository '${req.params.name}' resolves to nothing. ` +
        "Open a project from the home page, or set a server in Settings.",
    );
  });

  // A key belongs to the account, and the account lives on pl8 (apps/pl8/docs/projects.md).
  app.get("/pl8/api/projects/ssh-key", (_req, res) => {
    res.json({ publicKey: null });
  });

  // ── the shares ────────────────────────────────────────────────────────────

  app.get("/pl8/api/shares", (_req, res) => {
    res.json({ shares: [], revision: OFFLINE });
  });
  app.get("/pl8/api/shares/revision", (_req, res) => {
    res.json({ revision: OFFLINE });
  });

  // ── everything else under /pl8 ────────────────────────────────────────────

  /**
   * The catch-all, and it is what makes the rule true rather than aspirational: a route added
   * to pl8 later, or one I have not listed, still ANSWERS instead of falling through to the
   * SPA and handing back index.html for a fetch that wanted JSON.
   *
   * 503 rather than 404: the route exists, the server for it does not.
   */
  app.all(/^\/pl8(\/.*)?$/, (_req, res) => {
    say(res, 503, NO_SERVER);
  });
}
