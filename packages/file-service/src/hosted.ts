// hosted.ts — what makes this process one of a file hub's: its one gate is the hub's secret, it
// drives whichever engine the hub binds it to, and every separation runs on that engine's machine.
// See packages/file-hub/docs/fileHub.md.

import { timingSafeEqual } from "node:crypto";
import { setSeparationRunner } from "@studio/stem-separation/separateJobs";
import { HUB_SECRET_HEADER } from "@studio/web-protocol";
import express, { type RequestHandler, type Router } from "express";
import { boundJobsUrl, setBoundJobsUrl } from "./boundMachine.ts";
import { resolveColdRun } from "./coldRun.ts";
import { clearSelectedEngine, setSelectedEngine } from "./engineLink.ts";
import { remoteSeparationRunner } from "./remoteSeparation.ts";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: set by the file hub, never under turbo
const SECRET = process.env.STUDIO_HUB_SECRET ?? "";

if (!SECRET)
  throw new Error(
    "the file service runs under a file hub, and needs $STUDIO_HUB_SECRET — it has no other gate",
  );

// Every separation runs on the bound engine's machine, never on this server.
setSeparationRunner(remoteSeparationRunner(boundJobsUrl));

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
    setBoundJobsUrl(url ? String(body?.jobsUrl ?? "") || null : null);
    res.json({ ok: true });
  });
  // What a cut of this account's runs — for pl8, which drives the cut and holds the song.
  r.post("/hub/cold-chain", (req, res) => {
    const body = req.body as { chain?: unknown; want?: unknown };
    const run = resolveColdRun(
      String(body?.want ?? ""),
      String(body?.chain ?? ""),
    );
    if (!run.ok) {
      res.status(run.status).json({ error: run.error });
      return;
    }
    res.json({ model: run.model, outputs: run.outputs });
  });
  return r;
}
