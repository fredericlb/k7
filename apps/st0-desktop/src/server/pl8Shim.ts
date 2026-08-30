// pl8Shim.ts — pl8's routes, answered locally when no server is configured. The ONE rule:
// every one of them ANSWERS. A route that merely fails is not the same as a route that says
// no — `project-shell`'s gate runs its reachability probe on an unexpected throw, and that
// probe on a service which is plainly up always reports `blocked`, which draws the worst
// screen in the app ("this page isn't allowed to reach the engine", with a CORS story) on a
// machine where nothing is wrong. See ../../docs/pl8Shim.md.

import { NO_REGISTER } from "@studio/web-protocol/projects";
import type { Express, Response } from "express";

/**
 * Constant, and that is the point: `Home` polls `/revision` and refetches when it MOVES. A
 * changing value would re-ask an empty register forever. It also TELLS the page there is no
 * register at all rather than an empty one — `hasRegister`, in @studio/web-protocol/projects.
 */
const OFFLINE = NO_REGISTER;

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
  // NO register, no libraries pointer, no key: this service knows nothing about git, and
  // neither does the one it stands in for. A repository is a folder on this machine, the key is
  // made here (`packages/file-service/src/sshKeys.ts`) and the libraries pointer sits beside the
  // workspaces — apps/st0/frontend/docs/projects.md. The catch-all below answers those paths.

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
