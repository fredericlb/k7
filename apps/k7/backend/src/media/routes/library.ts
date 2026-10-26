// library.ts — the media library over HTTP, one router over five groups: reading, writing,
// measuring, the zones no family scan reaches, and the songbook kept in song folders. See packages/mediatek/docs/songs.md.
// No two groups share a method and a path, so the order they are mounted in decides nothing.

import { Router } from "express";
import { analysisRoutes } from "./library/analysis.ts";
import { readRoutes } from "./library/read.ts";
import { songbookRoutes } from "./library/songbook.ts";
import { writeRoutes } from "./library/write.ts";
import { zoneRoutes } from "./library/zones.ts";

export const libraryRouter: Router = Router();
libraryRouter.use(
  readRoutes,
  writeRoutes,
  analysisRoutes,
  zoneRoutes,
  songbookRoutes,
);
