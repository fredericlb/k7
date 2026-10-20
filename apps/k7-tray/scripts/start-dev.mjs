// start.mjs — run the unpackaged tray from the checkout.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startElectron } from "@frediverse/electron-shell/start";

startElectron(join(dirname(fileURLToPath(import.meta.url)), ".."));
