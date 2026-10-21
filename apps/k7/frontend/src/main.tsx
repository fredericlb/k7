// main.tsx — one branch, taken before anything heavy is imported: the documentation host and the editor share this
// origin and almost nothing else, and a static import of the editor would make the docs load the whole of k7.

import { isDocsHost } from "@studio/web-protocol/services";
import { reloadForChunk, reloadOnChunkError } from "./chunkReload";

reloadOnChunkError();

// Dynamic on both arms, since a static import is hoisted; a failure past the one reload is said in the page itself.
const boot = isDocsHost(window.location.hostname)
  ? import("./docs/mountSite")
  : import("./appMain");
boot.catch((e: unknown) => {
  if (reloadForChunk()) return;
  const root = document.getElementById("root");
  if (root)
    root.textContent = `k7 could not load (${(e as Error)?.message ?? e}) — reload the page.`;
});
