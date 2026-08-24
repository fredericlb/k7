// server.ts — st0/web backend: the engine registry, and serving the frontend. Every file
// operation belongs to the engine-side file service, which the browser reaches directly — so
// this hosted piece knows WHO you are and WHICH engines exist, never what is on any engine's
// disk. It MINTS the session every studio service verifies, being the one with no path prefix.
// Runs under tsx to import the brain's TS.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setupAuth } from "@frediverse/oidc";
import {
  ENGINE_BODY_LIMIT,
  engineErrorHandler,
  mountEngineRegistry,
} from "@studio/engine-registry";
import { prefsStore } from "@studio/user-prefs";
import { preferencesRouter } from "@studio/user-prefs/router";
import express from "express";
import { z } from "zod";

const PORT = process.env.PORT || 8789;
const app = express();

// The single-URL endpoint file a tray without `web-endpoints/` reads: written for compatibility, read by nothing here.
const WEB_ENDPOINT_PATH = join(homedir(), ".studio", "web-endpoint.json");
function advertiseLegacyEndpoint(url: string): void {
  try {
    mkdirSync(dirname(WEB_ENDPOINT_PATH), { recursive: true });
    writeFileSync(WEB_ENDPOINT_PATH, JSON.stringify({ url }) + "\n", "utf8");
  } catch {
    /* unwritable — the supervisor can still be pointed with --registry */
  }
}
// The relay pipes bodies to an engine's file service, so the limit is that service's (ENGINE_BODY_LIMIT).
app.use(express.json({ limit: ENGINE_BODY_LIMIT }));

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

// OUR registry, not the registry: pl8 holds its own (packages/engine-registry/docs/shared.md).
const engine = mountEngineRegistry(app, { service: "st0", requireAuth });

/** One person's layer over a command, as the WIRE shape — the meaning is the frontend's `commandPrefs.ts`. */
const commandPrefSchema = z.object({
  label: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
  icon: z.string().optional(),
  order: z.number().optional(),
  key: z.string().optional(),
  menu: z.boolean().optional(),
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

// Mounted LAST: a body that stops arriving throws inside the parser, where no route can see it.
app.use(engineErrorHandler);

const server = app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  // "auth" and not "verifies auth": this backend MINTS the session (../../AGENTS.md).
  console.log(`🎛  st0-web backend on ${url}  (registry; auth)`);
  // Cleanup goes INSIDE the shared goodbye: the socle exits in its own handlers, so a second never runs.
  engine.serve(server, url, () => {
    try {
      rmSync(WEB_ENDPOINT_PATH);
    } catch {
      /* no endpoint file */
    }
  });
  advertiseLegacyEndpoint(url);
});
