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

// Prefer the env the supervisor sets, else engine-id.json. We READ, never mint — identity is the supervisor's.
export function engineToken(): string {
  if (process.env.STUDIO_ENGINE_TOKEN) return process.env.STUDIO_ENGINE_TOKEN;
  try {
    const v = JSON.parse(readFileSync(engineIdPath(), "utf8"));
    return typeof v.token === "string" ? v.token : "";
  } catch {
    return "";
  }
}

// Reject callers without the engine's token; with none configured (a bare dev run) there is nothing to gate on.
export const requireEngineToken: RequestHandler = (req, res, next) => {
  const expected = engineToken();
  if (!expected) return next();
  if (req.get(ENGINE_TOKEN_HEADER) !== expected)
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
