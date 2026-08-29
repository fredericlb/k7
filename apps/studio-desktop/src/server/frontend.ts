// frontend.ts — st0's built SPA, served at the origin root. Two things it must get right:
// EVERY unknown path falls back to index.html (st0 reads `/external` and `/@local/…` from the
// address before its router runs, so a 404 there is a different app), and index.html must not
// be cached (after an upgrade the window would show the previous build, and two reloads would
// "fix" it — which reads as the build not having run).
// See ../../docs/server.md.

import { existsSync } from "node:fs";
import { join } from "node:path";
import express, { type Express } from "express";

/** Where the packaged app keeps st0's dist: flat in resources, like everything else stage.mjs puts there. */
export function bundledDist(resourcesPath: string): string | null {
  const dir = join(resourcesPath, "st0");
  return existsSync(join(dir, "index.html")) ? dir : null;
}

export function serveFrontend(app: Express, distDir: string): void {
  app.use(
    express.static(distDir, {
      // Hashed assets are immutable; the two files that name them are not.
      setHeaders(res, path) {
        if (/index\.html$|sw\.js$|manifest[^/]*\.webmanifest$/.test(path)) {
          res.setHeader("Cache-Control", "no-cache");
        } else {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
  // The catch-all. It is LAST, so a real file always wins, and it answers GET only: a POST to
  // a route that does not exist should 404, not receive a page.
  app.get(/.*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(join(distDir, "index.html"));
  });
}
