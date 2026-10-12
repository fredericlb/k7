// main.tsx — one branch, taken before anything heavy is imported. The tab strip and the editor
// share this origin and almost nothing else, and a static import of the editor would make a
// 36-pixel bar load the whole of st0 — which, in a window that draws both, is st0 twice.
// See apps/st0-desktop/docs/tabs.md.

import { isTabs, parseLaunch } from "@studio/project-shell/launch";
import { reloadForChunk, reloadOnChunkError } from "./chunkReload";

reloadOnChunkError();

const at = parseLaunch(
  window.location.pathname,
  "st0",
  import.meta.env.BASE_URL,
);

// Dynamic on BOTH arms: a static import is hoisted, so one would cost the other everything.
// …and the first chunk has no boundary above it: a failure past the one reload is said in the page itself.
const boot =
  at !== null && isTabs(at.repo)
    ? import("./tabs/mountStrip")
    : import("./appMain");
boot.catch((e: unknown) => {
  if (reloadForChunk()) return;
  const root = document.getElementById("root");
  if (root)
    root.textContent = `st0 could not load (${(e as Error)?.message ?? e}) — reload the page.`;
});
