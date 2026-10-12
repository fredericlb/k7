// useShare.ts — the two share-panel entries that are not already CLI verbs: render a mixdown
// through the engine, and publish to k7. Held here rather than in `SharePanel` so the panel and
// the command bar run one implementation — `project export` and `project share k7` are those
// same entries, and a second copy behind the palette is how the two come to differ.
//
// Commit and pull are NOT here: they are `project commit` / `project pull` in the catalogue,
// and the panel dispatches those rather than calling their routes a second time.

import { askConfirm, askText } from "@studio/project-shell/ask";
import type { VideoScene } from "@studio/ui-eyes/scene";
import { shareUrl } from "@studio/web-protocol/projects";
import { useCallback, useState } from "react";
import { api } from "../api";
import { downloadBlob as download } from "../downloadBlob";

import type { MixFormat, VideoFormat } from "../exportArgs";
import { m } from "../paraglide/messages.js";

export interface Share {
  /** A render is running: the menu greys itself out rather than starting a second one. */
  busy: boolean;
  exportMix: (format: MixFormat) => Promise<void>;
  /** …and the PICTURE, rendered here rather than by the engine — with the mixdown married in
   *  unless `audio` is null. The scene is the caller's: only the viewport's host has one. */
  exportVideo: (
    scene: VideoScene | null,
    format: VideoFormat,
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
    async (
      scene: VideoScene | null,
      format: VideoFormat,
      audio: MixFormat | null,
      name: string,
    ) => {
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
        // Loaded here, on the export: the muxer behind it is the heaviest thing the editor could ship and the rarest it runs.
        const { exportScene } = await import("@studio/ui-eyes/export");
        const file = await exportScene(
          scene,
          { format, ...(track ? { audio: track } : {}) },
          // A frame count, not a percentage: a viewport export is slow and "1200 / 4500" is the
          // only progress that says how slow.
          (p) => onStatus(`rendering ${p.frame} / ${p.total} frames…`),
        );
        // Named by the container itself: mediabunny owns both strings, so the two cannot drift.
        download(
          new Blob([file.buffer], { type: file.mimeType }),
          `${name || "video"}${file.extension}`,
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
            title: m["k7.newReleaseTitle"](),
            body: m["k7.newReleaseBody"](),
            placeholder: m["k7.artistPlaceholder"](),
            confirmLabel: m["common.continue"](),
            validate: (v) => (v.trim() ? "" : m["k7.artistRequired"]()),
          })
        )?.trim();
        if (!artist) {
          onStatus("k7 publish cancelled");
          return;
        }
        const asked = await askText({
          title: m["k7.titleTitle"](),
          initial: res.defaultTitle || "",
          placeholder: m["k7.titlePlaceholder"](),
          confirmLabel: m["k7.publish"](),
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
      title: m["share.confirmTitle"](),
      body: m["share.confirmBody"](),
      confirmLabel: m["share.publishLink"](),
    });
    if (!agreed) return;
    setBusy(true);
    onStatus(m["share.rendering"]());
    try {
      const { token, bytes } = await api.shareLink();
      const url = shareUrl(window.location.origin, token);
      const mb = Math.round(bytes / 1048576);
      try {
        await navigator.clipboard.writeText(url);
        onStatus(m["share.copied"]({ mb, url }));
      } catch {
        // A refused clipboard must not lose the link: it is the whole point of the command, and it exists exactly once.
        onStatus(m["share.done"]({ mb, url }));
      }
    } catch (e) {
      onStatus(m["share.failed"]({ error: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  }, [onStatus]);

  return { busy, exportMix, exportVideo, shareK7, shareLink };
}
