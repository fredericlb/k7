// server.ts — lanes/web backend: auth + the engine registry, and later serving the
// frontend. File operations moved to the engine-side file service, which the browser
// reaches directly — so this hosted piece knows WHO you are (OIDC) and WHICH engines exist,
// never what is on any engine's disk. Runs under tsx to import the brain's TypeScript.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setupAuth } from "@frediverse/oidc";
import { createRegistry, engineRegistryRouter } from "@studio/engine-registry";
import express from "express";

const PORT = process.env.PORT || 8789;
const app = express();

// Where the engine-host supervisor looks for the registry: `lanes --web` picks a free port, so we drop our
// real URL here on boot and remove it on shutdown. A hosted deploy sets LANES_REGISTRY_URL instead.
const WEB_ENDPOINT_PATH = join(homedir(), ".lanes", "web-endpoint.json");
function advertiseEndpoint(url: string): void {
  try {
    mkdirSync(dirname(WEB_ENDPOINT_PATH), { recursive: true });
    writeFileSync(WEB_ENDPOINT_PATH, JSON.stringify({ url }) + "\n", "utf8");
  } catch {
    /* unwritable — the supervisor can still be pointed with --registry */
  }
}

app.use(express.json({ limit: "8mb" }));

// Auth: the browser must be logged in before it can list or select engines (shared @frediverse/oidc).
// With no OIDC_* env it falls back to a dev stub, but a login is still mandatory.
const { requireAuth } = await setupAuth(app, {
  cookieName: "lanes.sid",
  service: "lanes-web-backend",
});

// Browser-facing registry routes need a session. Mounted before the router so the engine-to-backend routes
// (heartbeat, deregister — a machine authed by its own token) stay open.
app.use(["/api/engines", "/api/engine"], requireAuth);
// OUR registry, not the registry: mediatek holds its own, and an engine heartbeats to both.
// See packages/engine-registry/docs/shared.md for why that is not one central one.
app.use("/api", engineRegistryRouter(createRegistry()));

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`🎛  lanes-web backend on ${url}  (auth + registry)`);
  advertiseEndpoint(url); // so the engine tray can find the registry
});

// On shutdown, drop our registry endpoint file. (Windows force-kills us, so --web does this cleanup too.)
const bye = () => {
  try {
    rmSync(WEB_ENDPOINT_PATH);
  } catch {
    /* no endpoint file */
  }
  process.exit(0);
};
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
