// start.mjs — run an unpackaged app from the checkout.
// ELECTRON_RUN_AS_NODE is cleared because VS Code's terminals export it, and with it set Electron is plain node and opens no window.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Start Electron on `appRoot` with this process's arguments; exits with it. */
export function startElectron(appRoot) {
  const electron = require("electron");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [appRoot, ...process.argv.slice(2)], {
    env,
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  for (const sig of ["SIGINT", "SIGTERM"])
    process.on(sig, () => child.kill(sig));
}
