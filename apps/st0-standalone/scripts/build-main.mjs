// build-main.mjs — bundle the main process and the window's preload to dist/, with the shell's guard beside them.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMain } from "@frediverse/electron-shell/build";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await buildMain({
  appRoot: root,
  entries: ["main", "preload"].map((n) => join(root, "src", `${n}.ts`)),
});
