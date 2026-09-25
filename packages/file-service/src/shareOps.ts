// shareOps.ts — getting a project off this machine: the mixdown, the frozen snapshot sent to pl8,
// and the publish to k7. Four acts with one thing in common, and that is what makes them a module:
// each RENDERS first, then hands the result to somebody else.
//
// It takes a HOST of a few `Workspace` members rather than the whole class, the seam
// `projectLifecycle.ts` uses, so `safePath` and the rest do not become public API.

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

/** What an export needs of the workspace: six members instead of a class, so `safePath` stays private. */
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

/** Render the mixdown; the caller streams `path` then calls `cleanup`, whether or not it worked. */
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

/** The frozen snapshot `project share link` sends to pl8 — the three documents, and the three left out, in docs/share.md. */
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

/** Render the snapshot, send it to pl8, and answer the secret the link is built from — docs/share.md. */
export async function shareLink(
  host: ShareHost,
  userEmail: string,
): Promise<{ token: string; bytes: number }> {
  const base = mediatekBase();
  const token = mediatekToken();
  if (!base)
    throw new Error(
      "no médiathèque to share to — the file hub gave this service no MEDIATEK_URL",
    );
  if (!token)
    throw new Error(
      "no médiathèque token — the file hub gave this service no MEDIATEK_TOKEN",
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
    // The upload streams from these files, so they go only now — half a gigabyte of temp for a long song.
    bundle.cleanup();
  }
}

/** Publish to k7; an unknown song throws NEEDS_META, which the route turns into a prompt (docs/share.md). */
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
