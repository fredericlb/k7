// server.ts — the file service: one account's workspaces and every file op on them, run by the
// SERVER's file hub, one process per account (packages/file-hub/docs/fileHub.md). Loopback only,
// gated by the hub's secret. Drives whichever engine the hub binds it to, through that engine's
// tunnel; engines' machines run no file service. Run under tsx to import the brain's TS.

import { mkdirSync } from "node:fs";
import { wrap } from "@frediverse/http/route";
// k7's plugin contributions — commands and surface types — before anything reads a catalogue
// or compiles a song. The LIST is the plugins package's; this process only calls the install.
import { installBuiltinPlugins } from "@studio/k7-plugins/server";
import { ensureLayout } from "@studio/mediatek/layout";
import { ADMIN_HEADER, HUB_SECRET_HEADER } from "@studio/web-protocol";
import express from "express";
import { installProcessNet } from "./background.ts";
import { boundJobsUrl } from "./boundMachine.ts";
import { resolveUser, resolveWorkspace } from "./context.ts";
import { syncExamples } from "./demos.ts";
import { pruneIdleLinks } from "./engineLink.ts";
import { hubRouter, hubSecretOk, requireHubSecret } from "./hosted.ts";
import { followAdmin } from "./libraries.ts";
import { startPrefetch } from "./mediatekPrefetch.ts";
import { installModuleWatch } from "./moduleWatch.ts";
import { adoptRecordedOwner, requireRootOwner } from "./owner.ts";
import { accountRouter } from "./routes/accountRoutes.ts";
import { filesRouter } from "./routes/files.ts";
import { mediatekRouter } from "./routes/mediatek.ts";
import { workspacesRouter } from "./routes/workspacesRoutes.ts";
import { installServiceLog } from "./serviceLog.ts";
import { exitOnSignals, exitOnStdinEnd } from "./shutdown.ts";
import { rootDir } from "./slug.ts";
import {
  attachAllWorkspaces,
  getWorkspace,
  UnknownWorkspaceError,
} from "./workspaces.ts";

// First, so every line this process writes from here on is also the Logs panel's (docs/serviceLog.md).
installServiceLog();

installBuiltinPlugins();

// First and only here: one process holds the socket, the clock and the watcher — see background.ts.
installProcessNet();

const FILE_PORT = Number(process.env.STUDIO_FILE_PORT || 8770);

const app = express();

app.use(express.json({ limit: "8mb" }));

// --- Routes that can't send custom headers, mounted OUTSIDE the header gates ---

// Media for <video>: identity rides in the QUERY, and the hub stamps its secret on the request as on any other.
app.get(
  "/media",
  wrap((req, res) => {
    const user = String(req.query.user ?? "");
    const workspace = String(req.query.workspace ?? "");
    const path = String(req.query.path ?? "");
    if (!hubSecretOk(req.get(HUB_SECRET_HEADER))) {
      res.status(401).json({ error: "not from this service's file hub" });
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

// Liveness, ungated and deliberately EMPTY — the answer IS the payload; the hub waits on it at start.
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// --- Everything below is header-gated: the hub's secret + identity ---
app.use(requireHubSecret);
app.use(hubRouter());
app.use(resolveUser);
// The admin flag the hub stamped, applied to the library overlays before any route reads or writes one — docs/libraries.md.
app.use((req, _res, next) => {
  followAdmin(req.get(ADMIN_HEADER) === "1").then(() => next(), next);
});
// Workspaces are ONE account's, recorded on first use — docs/owner.md.
app.use(["/workspaces", "/engine/served", "/account"], requireRootOwner);

// The workspaces' own routes, BEFORE resolveWorkspace — routes/workspacesRoutes.ts.
app.use(workspacesRouter);

// The media library belongs to no workspace: the user for the gate, nothing more.
app.use(mediatekRouter);

// The machine's plugin questions and the account's chains and models — routes/accountRoutes.ts.
app.use(accountRouter);

// No cut route here: pl8 drives a separation and posts the bytes — see docs/processChain.md.

// Everything else needs a resolved workspace on req.ws, and is its owner's alone.
app.use(requireRootOwner, resolveWorkspace, filesRouter);

// Loopback: its only caller is the hub beside it.
const HOST = "127.0.0.1";
const server = app.listen(FILE_PORT, HOST, () => {
  mkdirSync(rootDir(), { recursive: true }); // ensure ~/.k7/root exists
  // The engine session is the recorded owner's from the first frame, not from the first request.
  adoptRecordedOwner();
  // Only a long-lived process may skip `@studio/song`'s module-stamp walk — see moduleWatch.ts.
  installModuleWatch();
  // Same for the media library, tolerated rather than required: its root may be an unmounted drive.
  try {
    console.log(`   mediatek: ${ensureLayout()}`);
  } catch (e) {
    console.warn(`   mediatek unavailable: ${(e as Error).message}`);
  }
  console.log(`📁 k7 file service on http://${HOST}:${FILE_PORT}`);
  console.log(`   root: ${rootDir()}`);
  // Examples stocked with this build's demos: a new account's first sight of k7, an old one's fixes.
  syncExamples();
  // Every workspace is a replica from the start, so one never opened here still sends and receives.
  attachAllWorkspaces();
  // The songs the open projects name, onto the bound engine's machine ahead of the gig.
  startPrefetch(boundJobsUrl);
  // Reap engine sockets nobody has used in minutes — an abandoned link re-dials forever, see pruneIdleLinks.
  setInterval(() => {
    for (const s of pruneIdleLinks())
      console.log(`   engine link idle, dropped: ${s}`);
  }, 60_000).unref();
});
// A quit or a redeploy stops this process by signal, or by its stdin closing: it stops accepting and exits 0 (docs/shutdown.md).
exitOnStdinEnd(exitOnSignals(server));
