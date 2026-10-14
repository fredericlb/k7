// start.mjs — run the unpackaged app from the checkout.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startElectron } from "@frediverse/electron-shell/start";

startElectron(join(dirname(fileURLToPath(import.meta.url)), ".."));
