#!/usr/bin/env node
// vscode.mjs — VS Code in the browser at https://code.priv.frediver.se (its own origin,
// served at the root, opening on the user's home with Git Bash as its terminal), by the
// `code serve-web` that ships with the installed editor. NOT part of the dev session —
// it is the door that must survive it: the studio-vscode logon task (scripts/remote.mjs)
// runs it on the dev box, and `npm run vscode` runs it alone. See docs/dev.md.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const PORT = 8798; // free: the proxy routes 3001-3006, 5173, 5223-5225, 8080, 8787-8796
const HOME = homedir();

/**
 * Check the port before spawning.
 *
 * `serve-web` prints "could not start server on the given host/port" and then exits **0**,
 * so without this a busy port looks like success with nothing serving.
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
      "  If https://code.priv.frediver.se/ does not answer, an orphaned server is holding it:\n" +
      "  find it with `Get-NetTCPConnection -LocalPort 8798` and stop that process tree.",
  );
  process.exit(0);
}

// The integrated terminal defaults to Git Bash. serve-web reads the server's own
// Machine settings (~/.vscode-server/data/Machine/settings.json), so the choice is
// made there — merged, not overwritten: the file may hold hand-made settings too.
const machineSettings = join(
  HOME,
  ".vscode-server",
  "data",
  "Machine",
  "settings.json",
);
try {
  let settings = {};
  if (existsSync(machineSettings))
    settings = JSON.parse(readFileSync(machineSettings, "utf8"));
  if (settings["terminal.integrated.defaultProfile.windows"] !== "Git Bash") {
    settings["terminal.integrated.defaultProfile.windows"] = "Git Bash";
    mkdirSync(dirname(machineSettings), { recursive: true });
    writeFileSync(machineSettings, `${JSON.stringify(settings, null, 2)}\n`);
  }
} catch (e) {
  console.error(`  could not set the default terminal profile: ${e.message}`);
}

console.log(
  `  VS Code web → https://code.priv.frediver.se/  (folder: ${HOME})\n`,
);

// No connection token. That is a decision, not an oversight: this is a dev-only config on an
// open-source repo, and the owner accepts that anyone who can reach code.priv.frediver.se gets an editor
// — which is a shell on this machine. `--host 0.0.0.0` because the LAN proxy (traefik)
// is another machine and reaches this port over the network; the LAN is the trust boundary.
// To put auth back: drop `--without-connection-token` and add
// `--connection-token-file <path>`; serve-web then trades `?tkn=` for a 7-day cookie.
const code = spawn(
  "code",
  [
    "serve-web",
    "--port",
    String(PORT),
    "--host",
    "0.0.0.0",
    "--without-connection-token",
    "--accept-server-license-terms",
    "--default-folder",
    HOME,
  ],
  {
    // No cwd: the folder the editor opens is --default-folder, nothing reads the cwd.
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
