// server.ts — st0/web backend: the origin's OIDC flow, this app's preferences, and serving the
// frontend. It holds NO engine registry: that is pl8's alone, and the frontend lists its engines
// from there (packages/engine-registry/docs/shared.md). Every file operation belongs to the
// engine-side file service, which the browser reaches directly — so this hosted piece knows WHO
// you are, never which engines exist or what is on any engine's disk. It MINTS the session every
// studio app verifies. This same process also serves the built SPA (docker/ ships no nginx) —
// see the static block near the bottom.
// Runs under tsx to import the brain's TS.

import { homedir } from "node:os";
import { join } from "node:path";
import { setupAuth } from "@frediverse/oidc";
import { engineErrorHandler } from "@studio/engine-registry";
import { prefsStore } from "@studio/user-prefs";
import { preferencesRouter } from "@studio/user-prefs/router";
import express from "express";
import { z } from "zod";

const PORT = process.env.PORT || 8789;
const app = express();

// Preferences are the only bodies left here; the relay that needed a file-service-sized limit is pl8's now.
app.use(express.json());

// Empty stays undefined, not []: setupAuth falls back on nullish only, and [] asks for NO scopes.
const scopes = (process.env.OIDC_SCOPES ?? "")
  .split(/[\s,]+/)
  .filter((s) => s !== "");

// This backend OWNS /auth/* for the whole origin, being the service with no prefix (../../AGENTS.md).
const { requireAuth } = await setupAuth(app, {
  cookieName: "studio.sid",
  // The env.yaml section, which is the PACKAGE name here as everywhere else.
  service: "st0-backend",
  // Dropping `groups` would 403 every z0 admin surface — see ../../AGENTS.md, § The backend in detail.
  ...(scopes.length > 0 ? { scopes } : {}),
});

/** One person's layer over a command, as the WIRE shape — the meaning is the frontend's `commandPrefs.ts`. */
const commandPrefSchema = z.object({
  label: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
  icon: z.string().optional(),
  order: z.number().optional(),
  key: z.string().optional(),
  // Which right-clicks may offer it: a list of entities, or `false` for none — see the frontend's commandPrefs.ts.
  menu: z.union([z.boolean(), z.array(z.string())]).optional(),
});

/** What this service remembers about a person — and it is the GATE, not a description: see ../../AGENTS.md. */
const prefsSchema = z.object({
  engineId: z.string().optional(),
  commands: z.record(z.string(), commandPrefSchema).optional(),
});
// Under the home directory so a dev run needs no volume (packages/user-prefs/docs/store.md).
const PREFS_DIR =
  process.env.STUDIO_PREFS_DIR || join(homedir(), ".studio", "prefs", "st0");
app.use(
  "/api",
  requireAuth,
  preferencesRouter(
    prefsStore<z.infer<typeof prefsSchema>>(PREFS_DIR),
    prefsSchema,
  ),
);

// The built SPA — this process's own frontend/dist, since there is no nginx in this image.
// Static files first (an asset request that matches a real file wins outright), then a
// catch-all SPA fallback for everything else EXCEPT /api and /auth, which answer their own
// 404 rather than being swallowed into the shell.
const FRONTEND_DIST = join(import.meta.dirname, "../../frontend/dist");
app.use(express.static(FRONTEND_DIST));
app.get(/^(?!\/api|\/auth)/, (_req, res) => {
  res.sendFile(join(FRONTEND_DIST, "index.html"));
});

// Mounted LAST: a body that stops arriving throws inside the parser, where no route can see it.
app.use(engineErrorHandler);

app.listen(PORT, () => {
  // "auth" and not "verifies auth": this backend MINTS the session (../../AGENTS.md).
  console.log(`🎛  st0-web backend on http://localhost:${PORT}  (auth)`);
});
