// port.ts — the port is FIXED and persisted, and probing upward is only what happens when
// something already holds it. It must not be ephemeral: the file service captures its CORS
// allowlist at spawn, advertiseRegistry writes a URL other processes read, a tablet has the
// address bookmarked, and a service worker's scope is per-origin. See ../../docs/server.md.

import { createServer } from "node:http";

/** Can we bind it? Asked by binding, since anything else is a guess about someone else's socket. */
function free(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "0.0.0.0");
  });
}

/**
 * `want`, or the next free port above it. The caller persists what it got — a port that moves
 * every launch is the failure this whole file exists to avoid.
 */
export async function firstFreePort(want: number, tries = 20): Promise<number> {
  for (let p = want; p < want + tries; p++) {
    if (await free(p)) return p;
  }
  throw new Error(
    `no free port in ${want}..${want + tries - 1} — set webPort in <state>/engine-host.json`,
  );
}
