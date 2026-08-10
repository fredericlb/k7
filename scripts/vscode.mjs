#!/usr/bin/env node
// vscode.mjs — VS Code in the browser at https://st0.priv.frediver.se/dev, served by the
// `code serve-web` that ships with the installed editor. A ROOT turbo task (`//#vscode`),
// joined into `npm run dev` by scripts/dev.mjs naming it explicitly — a package filter
// cannot reach the root. Also runnable alone as `npm run vscode`. See docs/dev.md.

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

const PORT = 8798; // free: the proxy routes 3001-3006, 5173, 5223-5225, 8080, 8787-8796
const BASE_PATH = "/dev";

/**
 * Check the port before spawning.
 *
 * `serve-web` prints "could not start server on the given host/port" and then exits **0**,
 * so without this a busy port gives a green turbo task and nothing serving.
 */
function portFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

// Busy is reported and treated as SUCCESS, not failure: this runs inside `npm run dev`, and an
// editor already serving at that URL is the goal met — failing here would paint a red task in
// a session that is otherwise fine. A killed instance can leave a child holding the socket, so
// this also fires when nothing useful is listening; the message says where to look.
if (!(await portFree(PORT))) {
  console.log(
    `  port ${PORT} is already in use — not starting a second editor.\n` +
      `  If https://st0.priv.frediver.se${BASE_PATH}/ does not answer, an orphaned server is holding it:\n` +
      "  find it with `Get-NetTCPConnection -LocalPort 8798` and stop that process tree.",
  );
  process.exit(0);
}

console.log(`  VS Code web → https://st0.priv.frediver.se${BASE_PATH}/\n`);

// No connection token. That is a decision, not an oversight: this is a dev-only config on an
// open-source repo, and the owner accepts that anyone who can reach st0.priv.frediver.se gets an editor
// — which is a shell on the repo root, the proxy answering on every interface.
// `--host 127.0.0.1` stays because it costs nothing and keeps the proxy the only way in.
// To put auth back: drop `--without-connection-token` and add
// `--connection-token-file <path>`; serve-web then trades `?tkn=` for a 7-day cookie.
const code = spawn(
  "code",
  [
    "serve-web",
    "--port",
    String(PORT),
    "--host",
    "127.0.0.1",
    // the proxy does not strip /dev — same asymmetry as the SPAs, so the server must see it.
    "--server-base-path",
    BASE_PATH,
    "--without-connection-token",
    "--accept-server-license-terms",
    "--default-folder",
    repo,
  ],
  {
    cwd: repo,
    stdio: "inherit",
    shell: process.platform === "win32", // `code` is a .cmd shim here
  },
);

code.on("error", (e) => {
  console.error(
    `could not start VS Code's web server: ${e.message}\n` +
      "`code` must be on PATH — it ships with VS Code 1.82+ (Shell Command: Install 'code' command in PATH).",
  );
  process.exit(1);
});
code.on("exit", (c) => process.exit(c ?? 0));
