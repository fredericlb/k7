// context.ts — per-request identity + workspace resolution, and the light LAN gate.
// Phase-2 "local trust": the user-email header is taken on faith (the browser got it
// from the hosted backend's OIDC session); only the engine token is verified, so the
// service isn't wide open on the LAN.

import { readFileSync } from "node:fs";
import { engineIdPath } from "@studio/engine-client/paths";
import {
  ENGINE_TOKEN_HEADER,
  USER_HEADER,
  WORKSPACE_HEADER,
} from "@studio/web-protocol";
import type { RequestHandler } from "express";
import { getWorkspace, UnknownWorkspaceError } from "./workspaces.ts";

/** What this machine can check a caller against — three states, since "" would open every route. */
type TokenState =
  | { k: "token"; value: string }
  /** No identity on this machine at all: a bare dev run, genuinely nothing to compare with. */
  | { k: "none" }
  /** There IS one and it could not be read. Refuse: a broken read must not read as open. */
  | { k: "unreadable"; why: string };

// Prefer the env the supervisor sets, else engine-id.json. We READ, never mint — identity is the supervisor's.
export function engineTokenState(): TokenState {
  if (process.env.STUDIO_ENGINE_TOKEN)
    return { k: "token", value: process.env.STUDIO_ENGINE_TOKEN };
  let raw: string;
  try {
    raw = readFileSync(engineIdPath(), "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    // Absent is the ONLY innocent failure: no supervisor has ever run here.
    if (err.code === "ENOENT") return { k: "none" };
    return { k: "unreadable", why: err.message };
  }
  try {
    const v = JSON.parse(raw);
    if (typeof v.token === "string" && v.token)
      return { k: "token", value: v.token };
    return { k: "unreadable", why: "no token in engine-id.json" };
  } catch {
    return { k: "unreadable", why: "engine-id.json is not JSON" };
  }
}

/** The token to compare against, or "" when there is nothing to compare with. */
export function engineToken(): string {
  const s = engineTokenState();
  return s.k === "token" ? s.value : "";
}

// Reject callers without the engine's token; an unreadable secret is not the absence of a secret.
export const requireEngineToken: RequestHandler = (req, res, next) => {
  const state = engineTokenState();
  if (state.k === "none") return next();
  if (state.k === "unreadable") {
    console.error(`✗ engine identity unreadable, refusing: ${state.why}`);
    return res.status(503).json({ error: "engine identity unreadable" });
  }
  if (req.get(ENGINE_TOKEN_HEADER) !== state.value)
    return res.status(401).json({ error: "bad or missing engine token" });
  next();
};

// The authenticated user's email (trusted). 400 if absent.
export const resolveUser: RequestHandler = (req, res, next) => {
  const email = req.get(USER_HEADER);
  if (!email) return res.status(400).json({ error: "missing user header" });
  req.userEmail = email;
  next();
};

// The chosen workspace → a live Workspace instance on req.ws. 400 if absent/invalid.
export const resolveWorkspace: RequestHandler = (req, res, next) => {
  const workspace = req.get(WORKSPACE_HEADER);
  if (!workspace)
    return res.status(400).json({ error: "missing workspace header" });
  try {
    req.ws = getWorkspace(req.userEmail!, workspace);
    next();
  } catch (e) {
    // 404 "isn't there" vs 400 "isn't a usable name": the browser sends the user back to the picker only for one.
    const code = e instanceof UnknownWorkspaceError ? 404 : 400;
    res.status(code).json({ error: (e as Error).message });
  }
};
