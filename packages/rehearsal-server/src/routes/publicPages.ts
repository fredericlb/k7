/* Public pages: the nametag is the whole address, mounted with no requireAuth — ../../docs/ownership.md.
 * What reads wrong: the page's own visibility still gates every route here, against whatever
 * session the request carries, since requireAuth never ran to copy it onto `req.user`. */

import { streamFile, wrap } from "@frediverse/http";
import { pageChoices, pageVersion } from "@studio/rehearsal-shared/pageVersion";
import type { PageVisibility } from "@studio/rehearsal-shared/pageVisibility";
import { type Request, type Response, Router } from "express";
import * as store from "../store.ts";

export const publicPagesRouter = Router();

type Viewer = { sub?: string } | undefined;

/** Who is asking: the device's person (publications.ts), else the browser's session, else nobody. */
function viewerOf(req: Request): string | null {
  const user = (req as { user?: Viewer }).user;
  const session = (req as { session?: { user?: Viewer } | null }).session;
  return user?.sub ?? session?.user?.sub ?? null;
}

/** The status refusing `viewer` this page, or null to let them through — 404 hides that it exists. */
export function refusal(
  page: { visibility: PageVisibility; ownerId: string },
  viewer: string | null,
): 401 | 404 | null {
  if (page.visibility === "public") return null;
  if (page.visibility === "authenticated") return viewer ? null : 401;
  return viewer !== null && viewer === page.ownerId ? null : 404;
}

/** The page if this request may open it; otherwise it has answered and gives null. */
async function opened(req: Request, res: Response, nametag: string) {
  const page = await store.getPageByNametag(nametag);
  const status = page ? refusal(page, viewerOf(req)) : 404;
  if (status === null) return page;
  res
    .status(status)
    .json({ error: status === 401 ? "unauthenticated" : "not found" });
  return null;
}

// Each release carries the versions a visitor may pick, the page's own pick as its default.
publicPagesRouter.get(
  "/:nametag",
  wrap(async (req, res) => {
    const page = await opened(req, res, req.params.nametag);
    if (!page) return;
    const { ownerId, versionIds, releases, ...pub } = page;
    res.json({
      ...pub,
      versionIds: {},
      releases: releases.map((release) => {
        const { ownerId: _, ...r } = release as typeof release & {
          ownerId?: string;
        };
        return {
          ...r,
          versions: pageChoices(page, r),
          defaultVersionId: pageVersion(page, r)?.id ?? null,
        };
      }),
    });
  }),
);

/** The release and version if this page opens and offers them; otherwise it has answered. */
async function offered(req: Request, res: Response) {
  const { nametag, rid, vid } = req.params;
  const page = await opened(req, res, nametag);
  if (!page) return null;
  const release = page.releases.find((r) => r.id === rid);
  const version =
    release && pageChoices(page, release).find((v) => v.id === vid);
  if (release && version) return { release, version };
  res.status(404).json({ error: "not found" });
  return null;
}

// Scoped through the page, so pulling a release off a page also pulls its audio — ../../docs/pages.md.
publicPagesRouter.get(
  "/:nametag/releases/:rid/versions/:vid/audio",
  wrap(async (req, res) => {
    if (!(await offered(req, res))) return;
    const info = await store.ensureVersionAudioCached(
      req.params.rid,
      req.params.vid,
    );
    if (!info) return res.status(404).json({ error: "no audio" });
    streamFile(req, res, info.filePath, info.mime);
  }),
);

publicPagesRouter.get(
  "/:nametag/releases/:rid/versions/:vid/envelope",
  wrap(async (req, res) => {
    if (!(await offered(req, res))) return;
    const envelope = await store.versionEnvelope(
      req.params.rid,
      req.params.vid,
    );
    if (!envelope) return res.status(404).json({ error: "no audio" });
    res.json(envelope);
  }),
);

// Only a release its owner marked downloadable; the switch is the whole permission.
publicPagesRouter.get(
  "/:nametag/releases/:rid/versions/:vid/download",
  wrap(async (req, res) => {
    const found = await offered(req, res);
    if (!found) return;
    if (!found.release.canDownload)
      return res.status(404).json({ error: "not found" });
    const { rid, vid } = req.params;
    const info = await store.ensureVersionAudioCached(rid, vid);
    if (!info) return res.status(404).json({ error: "no audio" });
    res.attachment(
      store.versionFileName(found.release, found.version, info.mime),
    );
    streamFile(req, res, info.filePath, info.mime);
  }),
);
