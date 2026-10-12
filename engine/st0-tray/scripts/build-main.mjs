// build-main.mjs — bundle the main process and the settings window's preload to dist/.
// `STUDIO_BUILD` is baked in here: it names WHEN this build was made, which the System tab shows.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMain } from "@frediverse/electron-shell/build";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await buildMain({
  appRoot: root,
  entries: ["main", "preload"].map((n) => join(root, "src", `${n}.ts`)),
  define: {
    "process.env.STUDIO_BUILD": JSON.stringify(
      process.env.STUDIO_BUILD ?? "dev",
    ),
  },
});
