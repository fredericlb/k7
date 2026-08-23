// shareOps.ts — sortir un projet de cette machine : le mixdown, l'instantané figé envoyé à pl8,
// et la publication vers k7. Quatre actes qui n'ont qu'une chose en commun et c'est ce qui en fait
// un module : chacun RENDRE d'abord, puis remettre le résultat à quelqu'un d'autre.
//
// Extrait de `workspace.ts` — 2707 lignes, 87 méthodes sur une classe — sur la couture que
// `projectLifecycle.ts` avait déjà posée : un HÔTE de quelques membres plutôt que la classe
// entière, pour que `safePath` et le reste ne deviennent pas de l'API publique. Ce groupe part le
// premier parce qu'il est le plus périphérique : rien d'autre dans la classe ne l'appelle.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  type K7Result,
  MP3_CODEC,
  readK7Config,
  renderMixdown,
  shareToK7,
  transcode,
} from "@studio/commands/render";
import {
  buildShareBundle,
  type ShareBundle,
  uploadShare,
} from "@studio/commands/share-bundle";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import type { WebGraph } from "@studio/graph-model";
import type { ProjectDoc } from "@studio/song/project";
import type { projectSurfaces } from "@studio/song/surfaces";
import type { WebProject } from "@studio/web-protocol";
import { mediatekBase, mediatekToken } from "./mediatekLink.ts";

/**
 * Ce qu'un export a besoin de savoir du workspace, et rien de plus.
 *
 * Six membres au lieu d'une classe : c'est ce qui permet de lire ce fichier sans ouvrir l'autre,
 * et ce qui empêche `safePath` de devenir publique par accident. Même forme que le
 * `lifecycleHost` d'à côté, et pour la même raison.
 */
export interface ShareHost {
  /** La racine de l'espace de travail — un dépôt cloné. Nommée dans l'origine d'un partage. */
  root: string;
  /** Le dossier du projet actif, ou une exception nommée s'il n'y en a pas. */
  requireActive(): string;
  /** Le document compilé que le moteur prend, mémoïsé par le workspace. */
  cachedProjectDoc(dir: string): ProjectDoc;
  /** Les trois documents qu'un NAVIGATEUR dessine un projet à partir de. */
  projectDoc(): WebProject;
  graphDoc(): WebGraph;
  surfaces(): ReturnType<typeof projectSurfaces>;
}

/**
 * Rendre le mixdown. `"mp3"` transcode, ce qui demande ffmpeg.
 *
 * L'appelant diffuse `path` puis appelle `cleanup` — le fichier vit dans un dossier temporaire
 * qui doit partir même si la diffusion échoue.
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
