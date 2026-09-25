// hosted.ts — the file service run by the SERVER's file hub, one process per account, instead
// of on the engine's machine. It listens on loopback only, its one gate is the hub's secret, and
// it drives whichever engine the hub binds it to. See packages/file-hub/docs/fileHub.md.

import { timingSafeEqual } from "node:crypto";
import { setSeparationRunner } from "@studio/stem-separation/separateJobs";
import { HUB_SECRET_HEADER } from "@studio/web-protocol";
import express, { type RequestHandler, type Router } from "express";
import { clearSelectedEngine, setSelectedEngine } from "./engineLink.ts";
import { remoteSeparationRunner } from "./remoteSeparation.ts";

// biome-ignore-start lint/suspicious/noUndeclaredEnvVars: set by the file hub, never under turbo
/** Whether this process belongs to a file hub rather than to an engine's machine. */
export const HOSTED = process.env.STUDIO_FILE_HOSTED === "1";
const SECRET = process.env.STUDIO_HUB_SECRET ?? "";
// biome-ignore-end lint/suspicious/noUndeclaredEnvVars: see above

if (HOSTED && !SECRET)
  throw new Error(
    "a hosted file service needs $STUDIO_HUB_SECRET — it has no other gate",
  );

/** Where this process's separations run: the bound engine's machine, never this server. */
let jobsUrl: string | null = null;
if (HOSTED) setSeparationRunner(remoteSeparationRunner(() => jobsUrl));

/** Constant-time compare against the hub's secret. */
export function hubSecretOk(supplied: string | undefined): boolean {
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const requireHubSecret: RequestHandler = (req, res, next) => {
  if (hubSecretOk(req.get(HUB_SECRET_HEADER))) return next();
  res.status(401).json({ error: "not from this service's file hub" });
};

/** The hub's own route: which engine to drive and where its machine takes jobs, as loopback `ws://` URLs, or none. */
export function hubRouter(): Router {
  const r = express.Router();
  r.post("/hub/engine", (req, res) => {
    const body = req.body as { url?: unknown; jobsUrl?: unknown };
    const url = String(body?.url ?? "");
    if (url) setSelectedEngine(url);
    else clearSelectedEngine();
    jobsUrl = url ? String(body?.jobsUrl ?? "") || null : null;
    res.json({ ok: true });
  });
  return r;
}
