// routes.ts — the apps' downloads: desktop.yml uploads a build under a bearer only it and this server know
// (/api/app-releases), and anyone fetches it at /app_downloads — the page, `<channel>.json` the desktop app's
// check reads, and every file of a build, latest*.yml included, which electron-updater reads. docs/app-downloads.md.

import { createHash, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { streamFile, wrap } from "@frediverse/http";
import { type RequestHandler, Router } from "express";
import { downloadsPage } from "./page.ts";
import {
  type AppReleaseStore,
  appReleaseStore,
  channelOf,
  isChannel,
  isFileName,
  TooLargeError,
} from "./store.ts";

/** Where builds are kept: the image sets it to its /data volume, a dev run keeps them in the home folder. */
export function storeFromEnv(env = process.env): AppReleaseStore {
  return appReleaseStore(
    env.STUDIO_APP_RELEASES_DIR || join(homedir(), ".studio", "app-releases"),
  );
}

/** One uploaded file's ceiling, `APP_RELEASE_MAX_MB` (2048 by default). */
export const maxBytesFromEnv = (env = process.env): number =>
  (Number(env.APP_RELEASE_MAX_MB) || 2048) * 1024 * 1024;

const digest = (s: string) => createHash("sha256").update(s).digest();

/** The CI's bearer, compared in constant time; no token configured refuses everyone. */
export function releaseToken(token: string | undefined): RequestHandler {
  const expected = token ? digest(token) : null;
  return (req, res, next) => {
    const sent = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1];
    if (!expected || !sent || !timingSafeEqual(digest(sent), expected))
      return void res.status(401).json({ error: "unauthorized" });
    next();
  };
}

/** /api/app-releases: one PUT per file, then a POST that makes the build its channel's current one. */
export function appReleasesRouter(
  store: AppReleaseStore,
  token: string | undefined,
  maxBytes: number,
): Router {
  const router = Router();
  router.use(releaseToken(token));

  router.put(
    "/:stamp/:file",
    wrap(async (req, res) => {
      const { stamp, file } = req.params as Record<string, string>;
      if (!channelOf(stamp) || !isFileName(file))
        return void res.status(400).json({ error: "invalid stamp or file" });
      try {
        res.status(201).json(await store.saveFile(stamp, file, req, maxBytes));
      } catch (e) {
        if (!(e instanceof TooLargeError)) throw e;
        res.set("Connection", "close").status(413).json({ error: e.message });
      }
    }),
  );

  router.post("/:stamp/publish", (req, res) => {
    const { stamp } = req.params as Record<string, string>;
    if (!channelOf(stamp))
      return void res.status(400).json({ error: "invalid stamp" });
    try {
      res.json(store.publish(stamp));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      res.status(404).json({ error: (e as Error).message });
    }
  });
  return router;
}

/** /app_downloads: no login, nothing per user, and `no-cache` throughout so a publish shows at once. */
export function appDownloadsRouter(store: AppReleaseStore): Router {
  const router = Router();

  router.get("/", (req, res) => {
    // No trailing slash: the page's relative links resolve against /app_downloads/.
    if (req.originalUrl.split("?")[0].endsWith("/"))
      return res.redirect(301, "/app_downloads");
    res.setHeader("Cache-Control", "no-cache");
    const builds = {
      release: store.current("release"),
      snapshot: store.current("snapshot"),
    };
    res
      .type("html")
      .send(downloadsPage(builds, req.acceptsLanguages("en", "fr") === "fr"));
  });

  // `release.json` / `snapshot.json`: the build a channel serves, for the desktop app's check.
  router.get("/:name", (req, res) => {
    const channel = /^(\w+)\.json$/.exec(req.params.name)?.[1] ?? "";
    const build = isChannel(channel) ? store.current(channel) : null;
    res.setHeader("Cache-Control", "no-cache");
    if (!build) return void res.status(404).json({ error: "not found" });
    res.json(build);
  });

  router.get("/:channel/:file", (req, res) => {
    const { channel, file } = req.params;
    const found = isChannel(channel) ? store.filePath(channel, file) : null;
    if (!found)
      return void res.status(404).type("text/plain").send("not found");
    res.setHeader("Cache-Control", "no-cache");
    const text = file.endsWith(".yml") || file === "SHA256SUMS";
    if (!text) res.setHeader("Content-Disposition", "attachment");
    streamFile(
      req,
      res,
      found,
      text ? "text/plain" : "application/octet-stream",
    );
  });
  return router;
}
