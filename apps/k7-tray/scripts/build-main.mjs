// build-main.mjs — bundle the main process and the settings window's preload to dist/.
// `$STUDIO_RELEASE_STAMP` is inlined as the app's release (@studio/app-updates/release); anything but the two CI shapes is `dev`.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMain } from "@frediverse/electron-shell/build";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const given = process.env.STUDIO_RELEASE_STAMP?.trim() ?? "";
// The shapes tray.yml's `decide` lets through: the stamp is shown in the System tab and compared with /app_downloads' builds.
const stamp = /^(v\d+\.\d+\.\d+|snapshot-[0-9a-f]{7,40})$/.test(given)
  ? given
  : "dev";

await buildMain({
  appRoot: root,
  entries: ["main", "preload"].map((n) => join(root, "src", `${n}.ts`)),
  define: { __K7_RELEASE__: JSON.stringify(stamp) },
});
