#!/usr/bin/env node
// restart-tray.mjs — `npm run tray:restart`: the tray's edit→run loop. Stops every running
// tray (single-instance would make our launch the no-op, and Windows locks the exe against
// the relink), rebuilds the dev app, starts it, and waits for the merged log to say the
// supervisor came up — so the exit code, not a screenshot, says whether the tray is alive.
// The steps themselves live in trayProcess.mjs. See docs/restartTray.md.

import { buildDevApp, launch, stopAll } from "./trayProcess.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);

try {
  await stopAll();
  if (flag("stop")) process.exit(0);
  if (!flag("no-build")) buildDevApp();
  console.log(`\n${await launch()}`);
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(err.status ?? 1);
}
