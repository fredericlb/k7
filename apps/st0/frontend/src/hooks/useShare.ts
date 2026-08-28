// useShare.ts — the two share-panel entries that are not already CLI verbs: render a mixdown
// through the engine, and publish to k7. Held here rather than in `SharePanel` so the panel and
// the command bar run one implementation — `project export` and `project share k7` are those
// same entries, and a second copy behind the palette is how the two come to differ.
//
// Commit and pull are NOT here: they are `project commit` / `project pull` in the catalogue,
// and the panel dispatches those rather than calling their routes a second time.

import { askConfirm, askText } from "@studio/project-shell/ask";
import { exportScene } from "@studio/ui-eyes";
import type { VideoScene } from "@studio/ui-eyes/scene";
import { shareUrl } from "@studio/web-protocol/projects";
import { useCallback, useState } from "react";
import { api } from "../api";

/** Save a fetched blob to the user's disk under `filename`. */
function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// One vocabulary for the formats, shared with the line that names them — ../exportArgs.ts.
export { MIX_FORMATS, type MixFormat } from "../exportArgs";

import type { MixFormat } from "../exportArgs";

export interface Share {
  /** A render is running: the menu greys itself out rather than starting a second one. */
  busy: boolean;
  exportMix: (format: MixFormat) => Promise<void>;
  /** …and the PICTURE, rendered here rather than by the engine — with the mixdown married in
   *  unless `audio` is null. The scene is the caller's: only the viewport's host has one. */
  exportVideo: (
    scene: VideoScene | null,
    audio: MixFormat | null,
    name: string,
  ) => Promise<void>;
  shareK7: () => Promise<void>;
  shareLink: () => Promise<void>;
}

export function useShare(onStatus: (s: string) => void): Share {
  const [busy, setBusy] = useState(false);

  const exportMix = useCallback(
    async (format: MixFormat) => {
      setBusy(true);
      onStatus(`rendering ${format.toUpperCase()} mixdown…`);
      try {
        const { blob, filename } = await api.exportMix(format);
        download(blob, filename);
        onStatus(`exported ${filename}`);
      } catch (e) {
        onStatus(`export failed: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [onStatus],
  );

  const exportVideo = useCallback(
    async (scene: VideoScene | null, audio: MixFormat | null, name: string) => {
      if (!scene) {
        onStatus("this project draws no picture — nothing to render");
        return;
      }
      setBusy(true);
      try {
        // The sound FIRST: the engine renders it, and a failure there should not cost a minute
        // of frames. Decoded here because the container wants neither a wav nor an mp3.
        let track: AudioBuffer | undefined;
        if (audio) {
          onStatus(`rendering ${audio.toUpperCase()} mixdown…`);
          const { blob } = await api.exportMix(audio);
          const ctx = new AudioContext();
          try {
            track = await ctx.decodeAudioData(await blob.arrayBuffer());
          } finally {
            void ctx.close();
          }
        }
        const total = Math.max(1, Math.round(scene.durationSec * scene.fps));
        onStatus(`rendering ${total} frames…`);
        const mp4 = await exportScene(
          scene,
          track ? { audio: track } : {},
          // A frame count, not a percentage: a viewport export is slow and "1200 / 4500" is the
          // only progress that says how slow.
          (p) => onStatus(`rendering ${p.frame} / ${p.total} frames…`),
        );
        download(
          new Blob([mp4], { type: "video/mp4" }),
          `${name || "video"}.mp4`,
        );
        onStatus(`exported ${total} frames`);
      } catch (e) {
        onStatus(`export failed: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [onStatus],
  );

  const shareK7 = useCallback(async () => {
    setBusy(true);
    onStatus("publishing to k7…");
    try {
      let res = await api.shareK7();
      // A song k7 doesn't know yet: ask for artist/title, then publish for real.
      if (res.needsMeta) {
        const artist = (
          await askText({
            title: "Nouvelle sortie k7",
            body: "k7 ne connaît pas encore ce morceau : il lui faut un artiste et un titre.",
            placeholder: "l'artiste",
            confirmLabel: "Continuer",
            validate: (v) => (v.trim() ? "" : "une sortie nomme son artiste"),
          })
        )?.trim();
        if (!artist) {
          onStatus("k7 publish cancelled");
          return;
        }
        const asked = await askText({
          title: "Titre",
          initial: res.defaultTitle || "",
          placeholder: "le titre",
          confirmLabel: "Publier",
        });
        // Cancelling the SECOND question abandons too: the first one already started nothing.
        if (asked === null) {
          onStatus("k7 publish cancelled");
          return;
        }
        const title = asked.trim() || res.defaultTitle || "";
        onStatus("publishing to k7…");
        res = await api.shareK7({ artist, title });
      }
      if (res.ok)
        onStatus(
          `${res.created ? "created release" : "added a version"}: ${res.title} ` +
            `(${res.stems ?? 0} stem${res.stems === 1 ? "" : "s"})`,
        );
      else onStatus("k7 publish did not complete");
    } catch (e) {
      onStatus(`k7 publish failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [onStatus]);

  /** Freeze this project and put its link on the clipboard — it ASKS first, naming what leaves, and the address is built in the browser. */
  const shareLink = useCallback(async () => {
    const agreed = await askConfirm({
      title: "Partager une version gelée de ce projet ?",
      body:
        "Toute personne ayant le lien pourra l'écouter et voir les pistes, les chaînes et " +
        "les paramètres des modules — sans compte. Le nom des pistes, des repères, des " +
        "modules et le texte des notes en font partie.\n\n" +
        "Le lien reste valable jusqu'à ce que vous le révoquiez, dans Projets sur pl8.",
      confirmLabel: "Publier le lien",
    });
    if (!agreed) return;
    setBusy(true);
    onStatus("rendu du partage… (le morceau entier, ça prend un moment)");
    try {
      const { token, bytes } = await api.shareLink();
      const url = shareUrl(window.location.origin, token);
      const mb = Math.round(bytes / 1048576);
      try {
        await navigator.clipboard.writeText(url);
        onStatus(`lien copié — ${mb} Mo partagés : ${url}`);
      } catch {
        // A refused clipboard must not lose the link: it is the whole point of the command, and it exists exactly once.
        onStatus(`partagé (${mb} Mo) — ${url}`);
      }
    } catch (e) {
      onStatus(`partage impossible : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [onStatus]);

  return { busy, exportMix, exportVideo, shareK7, shareLink };
}
