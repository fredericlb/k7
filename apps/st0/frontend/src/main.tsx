// main.tsx — one branch, taken before anything heavy is imported. The tab strip and the editor
// share this origin and almost nothing else, and a static import of the editor would make a
// 36-pixel bar load the whole of st0 — which, in a window that draws both, is st0 twice.
// See apps/studio-desktop/docs/tabs.md.

import { isTabs, parseLaunch } from "@studio/project-shell/launch";

const at = parseLaunch(
  window.location.pathname,
  "st0",
  import.meta.env.BASE_URL,
);

// Dynamic on BOTH arms: a static import is hoisted, so one would cost the other everything.
if (at !== null && isTabs(at.repo)) void import("./tabs/mountStrip");
else void import("./appMain");
