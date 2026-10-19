// sitePage.ts — what the root domain shows, k7.rocks and www.k7.rocks: the startup splash and "Coming soon".
// One self-contained page, the drawing inlined; on those hosts only /app_downloads stays k7's (../docs/site.md).

import type { NextFunction, Request, Response } from "express";
import splash from "../../frontend/icon/k7-splash.inline.json" with {
  type: "json",
};

/** The hosts that answer with this page, from `$STUDIO_SITE_HOSTS`; unset is none, as in dev and on a desktop. */
export function siteHostsFromEnv(
  value = process.env.STUDIO_SITE_HOSTS,
): Set<string> {
  return new Set(
    (value ?? "")
      .split(/[\s,]+/)
      .map((h) => h.trim().toLowerCase())
      .filter((h) => h !== ""),
  );
}

// What still passes on those hosts: the download page and its feed, and the tab's icon from the built SPA.
const PASSES = [/^\/app_downloads(\/|$)/, /^\/favicon\.ico$/];

export const SITE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="theme-color" content="#07031F">
<title>k7 — coming soon</title><style>
html,body{margin:0;height:100%;background:#07031F;color:#e9e9ee;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px;padding:24px;box-sizing:border-box}
svg{display:block;width:min(80vw,520px);height:auto}
h1{margin:0;font-size:clamp(20px,4vw,28px);font-weight:500;letter-spacing:.08em;color:#b8b3d9}
</style></head><body><main>${splash.svg}<h1>Coming soon</h1></main></body></html>`;

/** On a site host: `/` is the page, the passes go on, every other address goes to `/`. */
export function sitePage(hosts: Set<string>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (
      !hosts.has(req.hostname.toLowerCase()) ||
      PASSES.some((p) => p.test(req.path))
    ) {
      next();
    } else if (
      req.path !== "/" ||
      (req.method !== "GET" && req.method !== "HEAD")
    ) {
      res.redirect(302, "/");
    } else {
      res.setHeader("Cache-Control", "no-cache");
      res.type("html").send(SITE_PAGE);
    }
  };
}
