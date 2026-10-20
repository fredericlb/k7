// stage.mjs — build staging/ for electron-builder: the engine, the supervisor and what they load, and the settings page.
// No server ships here, so no source tree and no node_modules: the main process is the whole of the app's JavaScript.

import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stageEngine } from "@studio/supervisor-host/stageEngine";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(app, "..", "..");
const staging = join(app, "staging");
const page = join(app, "settings");

rmSync(staging, { recursive: true, force: true });

console.log("· engine and supervisor");
stageEngine({ repo, bin: join(staging, "bin") });

console.log("· settings page");
mkdirSync(join(staging, "settings"), { recursive: true });
for (const f of readdirSync(page))
  cpSync(join(page, f), join(staging, "settings", f));

console.log(`staged in ${staging}`);
