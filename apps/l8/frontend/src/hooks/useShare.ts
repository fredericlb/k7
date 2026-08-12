// useShare.ts — the two share-menu entries that are not already CLI verbs: render a mixdown
// through the engine, and publish to k7. Lifted out of ShareMenu so the dropdown and the
// command bar run one implementation — `project export` and `project share k7` are those same
// entries, and a second copy behind the palette is how the two come to differ.
//
// Commit and pull are NOT here: they are `project commit` / `project pull` in the catalogue,
// and the menu dispatches those rather than calling their routes a second time.

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

  return { busy, exportMix, shareK7 };
}
