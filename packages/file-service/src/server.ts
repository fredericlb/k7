// server.ts — the engine-side file service: owns ~/.studio/root/<user>/<workspace>
// and serves every file op to the browser DIRECTLY (cross-origin, hence CORS). Dials
// the LOCAL C++ engine to compile-and-send; the browser drives transport itself.
// Spawned by the engine-host supervisor, run under tsx to import the brain's TS.

import { timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { validate, wrap } from "@frediverse/http/route";
import { scannedPluginNames } from "@studio/engine-client/pluginCache";
import { ensureLayout } from "@studio/mediatek/layout";
import cors from "cors";
import express from "express";
import { z } from "zod";
import {
  engineToken,
  requireEngineToken,
  resolveUser,
  resolveWorkspace,
} from "./context.ts";
import { allowedOrigin, originPolicySummary } from "./cors.ts";
import { syncAllRepos } from "./demos.ts";
import { setSelectedEngine } from "./engineLink.ts";
import { startMediatekPuller } from "./mediatekPull.ts";
import { record as recordRefusedOrigin } from "./pendingOrigins.ts";
import { filesRouter } from "./routes/files.ts";
import { mediatekRouter } from "./routes/mediatek.ts";
import { renderRouter } from "./routes/render.ts";
import { rootDir, slugify, workspaceRoot } from "./slug.ts";
import { generateKey, publicKey } from "./sshKeys.ts";
import {
  cloneWorkspace,
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  UnknownWorkspaceError,
} from "./workspaces.ts";

const FILE_PORT = Number(process.env.STUDIO_FILE_PORT || 8770);
const ENGINE_PORT = Number(process.env.STUDIO_ENGINE_PORT || 8765);

const app = express();

// The callback form is deliberate: `origin: true` would reflect ANY origin. A refusal is RECORDED so the tray can
// offer it as a question — see docs/corsAndOrigins.md.
app.use(
  cors({
    origin: (o, cb) => {
      const ok = allowedOrigin(o);
      if (!ok) recordRefusedOrigin(o);
      cb(null, ok);
    },
    credentials: false,
  }),
);
// Any OPTIONS here was refused above, and running on returns a 401 that lies: a preflight carries no header.
app.use((req, res, next) => {
  if (req.method !== "OPTIONS") return next();
  res.status(403).json({
    error: "origin not allowed",
    origin: req.get("origin") ?? null,
    hint: "allow it from the tray: Web UI ▸ the blocked origin",
  });
});

app.use(express.json({ limit: "8mb" }));

// Constant-time compare of a query token, mirroring requireEngineToken's "no token configured => allow".
function mediaTokenOk(supplied: string): boolean {
  const expected = engineToken();
  if (!expected) return true;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- Routes that can't send custom headers, mounted OUTSIDE the header gates ---

// Media streaming for <video>: an element GET can't set headers, so user, workspace and token ride in the QUERY —
// which is why this route sits outside the header gates. Read-only, with the traversal guard still applied.
// Residual risk, deliberate: a token holder can read any user's media here. See docs/corsAndOrigins.md.
app.get(
  "/media",
  wrap((req, res) => {
    const user = String(req.query.user ?? "");
    const workspace = String(req.query.workspace ?? "");
    const path = String(req.query.path ?? "");
    if (!mediaTokenOk(String(req.query.token ?? ""))) {
      res.status(401).json({ error: "bad or missing engine token" });
      return;
    }
    if (!user || !workspace || !path) {
      res.status(400).json({ error: "user, workspace and path required" });
      return;
    }
    let abs: string;
    try {
      abs = getWorkspace(user, workspace).mediaPath(path);
    } catch (e) {
      res
        .status(e instanceof UnknownWorkspaceError ? 404 : 400)
        .json({ error: (e as Error).message });
      return;
    }
    res.sendFile(abs, (err) => {
      if (!err || res.headersSent) return;
      const code = (err as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 400;
      res.status(code).json({ error: (err as Error).message });
    });
  }),
);

// Liveness, deliberately ungated and deliberately EMPTY: its one caller is a browser telling "my origin is refused"
// apart from "nothing is listening", which fetch() reports identically. It must reveal nothing — the answer IS the
// payload — and it sits after the cors middleware so a refused probe is still recorded for the tray.
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// --- Everything below is header-gated: engine token + identity ---
app.use(requireEngineToken);
app.use(resolveUser);

// The workspace picker needs only the user, so it is registered BEFORE resolveWorkspace.
app.get(
  "/workspaces",
  wrap((req, res) => res.json({ workspaces: listWorkspaces(req.userEmail!) })),
);
const newWsBody = z.object({ name: z.string().min(1) });
app.post(
  "/workspaces",
  validate(newWsBody),
  wrap((req, res) => {
    const { name } = req.body as z.infer<typeof newWsBody>;
    // The ONE place a workspace is created on request — getWorkspace deliberately refuses to (Examples aside).
    try {
      createWorkspace(req.userEmail!, name);
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }
    res.json({ ok: true });
  }),
);

// Cloning runs HERE because this machine owns ~/.studio/root, and the per-user SSH key lives here too.
const cloneBody = z.object({ name: z.string().min(1), uri: z.string().min(1) });
app.post(
  "/workspaces/clone",
  validate(cloneBody),
  wrap(async (req, res) => {
    const { name, uri } = req.body as z.infer<typeof cloneBody>;
    try {
      await cloneWorkspace(req.userEmail!, name, uri);
    } catch (e) {
      // Everything cloneWorkspace throws is caller-fixable — bad URI, name taken, git's stderr — so 400, not 500.
      return res.status(400).json({ error: (e as Error).message });
    }
    res.json({ ok: true });
  }),
);

// The media library is per MACHINE, so it needs the user (for the gate) but no workspace —
// registered here for the same reason /workspaces is.
app.use(mediatekRouter);

// An offline bounce, for a hosted backend that cannot exec anything itself. Per MACHINE
// too — it is this machine's engine binary and this machine's plugins — and behind the same
// engine-token gate everything above it is. See docs/render.md.
app.use(renderRouter);

// What this machine's engine has SCANNED, grouped by format. Per machine like the two above and
// for the same reason — the scan cache is `~/.studio/exts.json`, which belongs to no workspace and
// no project. `/hints` has carried the same list for a long time, but only alongside a compiled
// project, which is a thing the médiathèque does not have and will never have: it edits a library.
app.get(
  "/plugins",
  wrap((_req, res) => res.json({ pluginNames: scannedPluginNames() })),
);

// The user's SSH key: GET reads, POST generates if absent (idempotent). Only ever the PUBLIC half.
app.get(
  "/ssh-key",
  wrap((req, res) => res.json({ publicKey: publicKey(req.userEmail!) })),
);
app.post(
  "/ssh-key",
  wrap(async (req, res) => {
    res.json({ publicKey: await generateKey(req.userEmail!) });
  }),
);

// Everything else needs a resolved workspace on req.ws.
app.use(resolveWorkspace, filesRouter);

app.listen(FILE_PORT, "0.0.0.0", () => {
  mkdirSync(rootDir(), { recursive: true }); // ensure ~/.studio/root exists
  // Same for the media library. Tolerated rather than required: the root is overridable
  // and may point at a drive that isn't mounted, which must not stop the file service —
  // the catalogue then simply reports no library.
  try {
    console.log(`   mediatek: ${ensureLayout()}`);
  } catch (e) {
    console.warn(`   mediatek unavailable: ${(e as Error).message}`);
  }
  console.log(`📁 l8 file service on http://0.0.0.0:${FILE_PORT}`);
  console.log(`   root: ${rootDir()}`);
  // Bring every known repo's Examples level with this build's demos, so a fix reaches existing users unseeded.
  syncAllRepos();
  // Log the effective policy: a bad allowlist otherwise surfaces only as an unexplained browser failure.
  console.log(`   cors: ${originPolicySummary()}`);
  // Dial the local engine so file/command ops can compile-and-send the project.
  setSelectedEngine(`ws://127.0.0.1:${ENGINE_PORT}`);
  // Keep the médiathèque cache in step with the hosted library, for what the open songs name.
  startMediatekPuller();
});
