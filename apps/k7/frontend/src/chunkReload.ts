// chunkReload.ts — a code chunk that will not load is almost always a deploy: the open page names
// hashes the server no longer has. One reload fetches the new shell and its chunks; a second
// failure inside a minute is not a deploy, so it is left to the pane's boundary to say so.
// See docs/shell.md, "A fault stays in its pane".

const KEY = "k7.chunkReloadAt";
const WINDOW_MS = 60_000;

/** Reload once for a missing chunk; false when this tab already did so within the minute. */
export function reloadForChunk(): boolean {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY) ?? 0);
  } catch {
    // No storage, no memory of the last try: reloading blind could loop, so do not.
    return false;
  }
  if (Date.now() - last < WINDOW_MS) return false;
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/** Vite's own signal for a dynamic import that failed — every lazy pane and chunk goes through it. */
export function reloadOnChunkError(): void {
  window.addEventListener("vite:preloadError", (e) => {
    if (reloadForChunk()) e.preventDefault();
  });
}
