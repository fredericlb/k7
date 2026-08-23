// shareOps.ts — getting a project off this machine: the mixdown, the frozen snapshot sent to pl8,
// and the publish to k7. Four acts with one thing in common, and that is what makes them a module:
// each RENDERS first, then hands the result to somebody else.
//
// Extracted from `workspace.ts` — 2707 lines, 87 methods on one class — along the seam
// `projectLifecycle.ts` had already cut: a HOST of a few members rather than the whole class, so
// `safePath` and the rest do not become public API. This group left first because it is the most
// peripheral: nothing else in the class calls it.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  buildShareBundle,
  type ShareBundle,
  uploadShare,
} from "@studio/commands/share-bundle";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import type { WebGraph } from "@studio/graph-model";
import type { ProjectDoc } from "@studio/song/project";
import type { projectSurfaces } from "@studio/song/surfaces";
import {
  type K7Result,
  MP3_CODEC,
  readK7Config,
  renderMixdown,
  shareToK7,
  transcode,
} from "@studio/take-render/render";
import type { WebProject } from "@studio/web-protocol";
import { mediatekBase, mediatekToken } from "./mediatekLink.ts";

/**
 * What an export needs to know about the workspace, and nothing more.
 *
 * Six members instead of a class: that is what lets this file be read without opening the other,
 * and what stops `safePath` becoming public by accident. Same shape as the `lifecycleHost` next
 * door, and for the same reason.
 */
export interface ShareHost {
  /** The workspace root — a cloned repository. Named in a share's origin. */
  root: string;
  /** The active project's folder, or a named exception when there is none. */
  requireActive(): string;
  /** The compiled document the engine takes, memoised by the workspace. */
  cachedProjectDoc(dir: string): ProjectDoc;
  /** The three documents a BROWSER draws a project from. */
  projectDoc(): WebProject;
  graphDoc(): WebGraph;
  surfaces(): ReturnType<typeof projectSurfaces>;
}

/**
 * Render the mixdown. `"mp3"` transcodes, which needs ffmpeg.
 *
 * The caller streams `path` then calls `cleanup` — the file lives in a temporary folder that must
 * go even if streaming fails.
 */
export function exportMix(
  host: ShareHost,
  format: "wav" | "mp3",
): { path: string; filename: string; mime: string; cleanup: () => void } {
  const dir = host.requireActive();
  const engine = findEngineBinary();
  if (!engine)
    throw new Error("engine binary not found — cannot render the mixdown");
  const doc = host.cachedProjectDoc(dir);
  const tmp = mkdtempSync(join(tmpdir(), "tbmix-"));
  const cleanup = () => {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  };
  try {
    const manifest = renderMixdown(engine, doc, tmp);
    const wav = join(tmp, manifest.mix);
    const name = (doc.name || basename(dir) || "mixdown").replace(
      /[\\/:*?"<>|]+/g,
      "_",
    );
    if (format === "wav")
      return { path: wav, filename: `${name}.wav`, mime: "audio/wav", cleanup };
    const mp3 = join(tmp, "mix.mp3");
    if (!transcode(wav, mp3, MP3_CODEC))
      throw new Error(
        "mp3 needs ffmpeg on the engine host — install ffmpeg, or use Export WAV",
      );
    return { path: mp3, filename: `${name}.mp3`, mime: "audio/mpeg", cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

/**
 * The frozen snapshot `project share link` sends to pl8 — rendered here, uploaded by the caller.
 *
 * The three documents are what a BROWSER draws a project from, and each is here for a reason
 * the next person should not have to re-derive:
 *
 * - `project-doc.json` (`WebProject`) is the arrangement. It carries `sourceName` — the audio
 *   file's NAME and never its path — so it says what a clip is called without saying where
 *   anything lives on this machine.
 * - `graph.json` (`WebGraph`) is the chains, the modules and their AUTHORED parameter values.
 *   That is the feature: "see the modules without editing them" is this document.
 * - `surfaces.json` is what the project DECLARES, verbatim. A project with a viewport surface
 *   is shared with that surface still declared and no video beside it; the snapshot says which
 *   media it carries (`media.video: false`) rather than editing the project's own claims.
 *
 * Three documents are deliberately NOT here. `video-doc` carries workspace-relative media paths
 * (`toWebVideoTracks`) and the share is audio-only anyway; `project-errors` quotes file paths
 * and lines of YAML; `/tree` and `/file` are the source itself. A share shows the song, not the
 * folder it was made in.
 *
 * Nothing here writes to the project. Freezing a shared copy is a RENDER, not `node freeze` ×N.
 */
export function buildShare(host: ShareHost): ShareBundle {
  const dir = host.requireActive();
  const engine = findEngineBinary();
  if (!engine)
    throw new Error("engine binary not found — cannot render the share");
  const web = host.projectDoc();
  return buildShareBundle(
    engine,
    host.cachedProjectDoc(dir),
    {
      "project-doc.json": web,
      "graph.json": host.graphDoc(),
      "surfaces.json": host.surfaces(),
    },
    { name: web.name || basename(dir) },
  );
}

/**
 * Render the snapshot and send it to pl8. Answers the secret the link is built from.
 *
 * The credential is NOT k7's `.settings.json` pair but the machine's own pl8 bearer —
 * `mediatekBase()` / `mediatekToken()`, the `service:st0` token `npm run tokens` already writes
 * into the supervisor's settings for the library pull. Sharing needed no new plumbing: this
 * service has been talking to pl8 with it all along.
 *
 * A service token has no person of its own, so the user is named on every call (`?user=`) — the
 * same arrangement, and the same accepted cost, that `/ssh-key/private` documents.
 */
export async function shareLink(
  host: ShareHost,
  userEmail: string,
): Promise<{ token: string; bytes: number }> {
  const base = mediatekBase();
  const token = mediatekToken();
  if (!base)
    throw new Error("no médiathèque to share to — this machine caches none");
  if (!token)
    throw new Error(
      "no médiathèque token on this machine — run `npm run tokens`",
    );
  const dir = host.requireActive();
  const bundle = buildShare(host);
  try {
    const link = await uploadShare(bundle, {
      base,
      token,
      user: userEmail,
      // Where it came from, for the author's own list. Never served publicly.
      origin: { repo: basename(host.root), project: basename(dir) },
    });
    return { token: link.token, bytes: link.bytes };
  } finally {
    // The upload streams from these files, so they live until it is over — and go whether it
    // ended well or not. A share of a long song is half a gigabyte of temp.
    bundle.cleanup();
  }
}

/** Publish to k7. An unknown song throws NEEDS_META, which the route turns into a prompt for
 *  artist and title. Credentials sit at the WORKSPACE root — one k7 login serves every project. */
export async function shareK7(
  host: ShareHost,
  opts: { artist?: string; title?: string },
): Promise<K7Result> {
  const dir = host.requireActive();
  const engine = findEngineBinary();
  if (!engine)
    throw new Error("engine binary not found — cannot render the mixdown");
  const cfg = readK7Config(host.root);
  if ("error" in cfg) throw new Error(cfg.error);
  return shareToK7(engine, dir, cfg, opts);
}
