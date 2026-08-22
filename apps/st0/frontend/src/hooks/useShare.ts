// useShare.ts — the two share-panel entries that are not already CLI verbs: render a mixdown
// through the engine, and publish to k7. Held here rather than in `SharePanel` so the panel and
// the command bar run one implementation — `project export` and `project share k7` are those
// same entries, and a second copy behind the palette is how the two come to differ.
//
// Commit and pull are NOT here: they are `project commit` / `project pull` in the catalogue,
// and the panel dispatches those rather than calling their routes a second time.

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

export const MIX_FORMATS = ["wav", "mp3"] as const;
export type MixFormat = (typeof MIX_FORMATS)[number];
export const isMixFormat = (s: string): s is MixFormat =>
  (MIX_FORMATS as readonly string[]).includes(s);

export interface Share {
  /** A render is running: the menu greys itself out rather than starting a second one. */
  busy: boolean;
  exportMix: (format: MixFormat) => Promise<void>;
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

  const shareK7 = useCallback(async () => {
    setBusy(true);
    onStatus("publishing to k7…");
    try {
      let res = await api.shareK7();
      // A song k7 doesn't know yet: ask for artist/title, then publish for real.
      if (res.needsMeta) {
        const artist = window.prompt("Artist (new k7 release):", "")?.trim();
        if (!artist) {
          onStatus("k7 publish cancelled");
          return;
        }
        const title =
          window.prompt("Title:", res.defaultTitle || "")?.trim() ||
          res.defaultTitle ||
          "";
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

  /**
   * Freeze this project and put its link on the clipboard.
   *
   * It ASKS first, and the question names what leaves rather than saying "are you sure": a
   * snapshot carries every track's name, every marker's name, every module's name and the text of
   * every note in the graph, to anyone the link reaches. That is the feature, and it is also the
   * kind of thing that ships without anyone thinking about it.
   *
   * The address is built in the browser (`shareUrl`), because only the tab knows which origin it
   * is on — the machine that rendered does not.
   */
  const shareLink = useCallback(async () => {
    if (
      !window.confirm(
        "Partager une version gelée de ce projet ?\n\n" +
          "Toute personne ayant le lien pourra l'écouter et voir les pistes, les chaînes et " +
          "les paramètres des modules — sans compte. Le nom des pistes, des repères, des " +
          "modules et le texte des notes en font partie.\n\n" +
          "Le lien reste valable jusqu'à ce que vous le révoquiez, dans Projets sur pl8.",
      )
    )
      return;
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
        // A refused clipboard must not lose the link: it is the whole point of the command, and
        // it exists exactly once.
        onStatus(`partagé (${mb} Mo) — ${url}`);
      }
    } catch (e) {
      onStatus(`partage impossible : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [onStatus]);

  return { busy, exportMix, shareK7, shareLink };
}
