// server.ts — m9's backend: OIDC auth, this service's engine registry, and what it
// remembers about a person. Exactly l8' shape and for the same reason — it knows WHO you
// are and WHICH engines exist, never what is on any engine's disk. The decks still reach
// the file service and the moteur directly, cross-origin, as they always did.

import { homedir } from "node:os";
import { join } from "node:path";
import { setupAuth } from "@frediverse/oidc";
import { createRegistry, engineRegistryRouter } from "@studio/engine-registry";
import { advertiseRegistry } from "@studio/engine-registry/advertise";
import { prefsStore } from "@studio/user-prefs";
import { preferencesRouter } from "@studio/user-prefs/router";
import express from "express";
import { z } from "zod";

const PORT = process.env.PORT || 8796;
const app = express();

app.use(express.json({ limit: "1mb" }));

// A login is mandatory even with no OIDC_* env (the shared dev stub stands in). It is what
// replaced the text box a DJ used to type their own identity into — an identity the file
// service then trusted, and which nothing checked.
const { requireAuth } = await setupAuth(app, {
  // The l8 backend owns /auth at the origin root; this one only VERIFIES its
  // cookie, so it mounts no auth routes. Same name and secret or the check fails.
  cookieName: "studio.sid",
  mountRoutes: [],
  service: "m9-backend",
});

// Browser-facing routes need a session; the engine-facing heartbeat stays open, a machine
// authenticating with its own token. Its OWN registry — see
// packages/engine-registry/docs/shared.md for why each service holds one.
app.use(["/api/engines", "/api/engine", "/api/preferences"], requireAuth);
app.use("/api", engineRegistryRouter(createRegistry()));

// The deck this account plays through. Same shape as l8' and the médiathèque's, a
// different store: which machine you DJ from is not which machine you write songs on.
const prefsSchema = z.object({ engineId: z.string().optional() });
const PREFS_DIR =
  process.env.STUDIO_PREFS_DIR || join(homedir(), ".studio", "prefs", "m9");
app.use(
  "/api",
  preferencesRouter(
    prefsStore<z.infer<typeof prefsSchema>>(PREFS_DIR),
    prefsSchema,
  ),
);

let unadvertise: (() => void) | null = null;

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`🎚  m9 backend on ${url}  (auth + registry)`);
  // This service holds its OWN registry, so the supervisor has to be told about it — an engine
  // heartbeats to every advertised URL, and one it never hears about lists no engines at all.
  unadvertise = advertiseRegistry("m9", url);
});

const bye = () => {
  unadvertise?.();
  process.exit(0);
};
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
