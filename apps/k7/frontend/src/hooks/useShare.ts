// useShare.ts — the two share-panel entries that are not already CLI verbs: render a mixdown
// through the engine, and publish to k7. Held here rather than in `SharePanel` so the panel and
// the command bar run one implementation — `project export` and `project share k7` are those
// same entries, and a second copy behind the palette is how the two come to differ.

import { askConfirm, askText } from "@studio/project-shell/ask";
import type { VideoScene } from "@studio/ui-eyes/scene";
import type { ShareProgress } from "@studio/web-protocol";
import { shareUrl } from "@studio/web-protocol/projects";
import { useCallback, useState } from "react";
import { api } from "../api";
import { downloadBlob as download } from "../downloadBlob";

import type {
  MixFormat,
  TimelineFormat,
  VideoFormat,
  VideoSettings,
} from "../exportArgs";
import { m } from "../paraglide/messages.js";
import { trackProcess } from "../processes";
import { shareProgressLine } from "../shareProgress";

export interface Share {
  /** A render is running: the menu greys itself out rather than starting a second one. */
  busy: boolean;
  exportMix: (format: MixFormat, timeline?: string) => Promise<void>;
  /** …and the PICTURE, rendered here rather than by the engine — with the mixdown married in
   *  unless `audio` is null. The scene is the caller's: only the viewport's host has one. */
  exportVideo: (
    scene: VideoScene | null,
    format: VideoFormat,
    audio: MixFormat | null,
    name: string,
    settings?: VideoSettings,
  ) => Promise<void>;
  /** …and the CUT, for another editor: `picture interchange` writes it, then it is downloaded (song-video docs/interchange.md). */
  exportTimeline: (
    project: string,
    format: TimelineFormat,
    lane: string | undefined,
    name: string,
    run: (line: string) => Promise<unknown>,
  ) => Promise<void>;
  shareK7: () => Promise<void>;
  shareLink: () => Promise<void>;
  /** Where the share being made is, for the panel's bar; null when none runs. */
  progress: ShareProgress | null;
}

/** How often the job is asked where it is: the renders take minutes, and the bar should not look stuck. */
const POLL_MS = 700;

export function useShare(onStatus: (s: string) => void): Share {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ShareProgress | null>(null);

  const exportMix = useCallback(
    async (format: MixFormat, timeline?: string) => {
      setBusy(true);
      const what = `${format.toUpperCase()} mixdown${timeline ? ` of ${timeline}` : ""}`;
      onStatus(`rendering ${what}…`);
      // A route, not a command, so the service lists nothing: this page lists it (docs/processes.md).
      const shown = trackProcess(`export ${what}`);
      try {
        const { blob, filename } = await api.exportMix(format, timeline);
        download(blob, filename);
        onStatus(`exported ${filename}`);
        shown.end();
      } catch (e) {
        onStatus(`export failed: ${(e as Error).message}`);
        shown.end((e as Error).message);
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
      settings: VideoSettings = {},
    ) => {
      if (!scene) {
        onStatus("this project draws no picture — nothing to render");
        return;
      }
      setBusy(true);
      // Rendered in this page, so no poll reports it: this page lists it (docs/processes.md).
      const shown = trackProcess(`export ${format.toUpperCase()} video`);
      try {
        // The sound FIRST: the engine renders it, and a failure there should not cost a minute
        // of frames. Decoded here because the container wants neither a wav nor an mp3.
        let track: AudioBuffer | undefined;
        if (audio) {
          onStatus(`rendering ${audio.toUpperCase()} mixdown…`);
          shown.progress(null, `${audio.toUpperCase()} mixdown`);
          const { blob } = await api.exportMix(audio);
          const ctx = new AudioContext();
          try {
            track = await ctx.decodeAudioData(await blob.arrayBuffer());
          } finally {
            void ctx.close();
          }
        }
        // The range, defaulting to the whole song; the size, a height alone taking the viewport's aspect.
        const from = settings.from ?? 0;
        const to = settings.to ?? scene.durationSec;
        const total = Math.max(1, Math.round((to - from) * scene.fps));
        const [vw, vh] = scene.viewport;
        const size: [number, number] | undefined = !settings.size
          ? undefined
          : "width" in settings.size
            ? [settings.size.width, settings.size.height]
            : [
                Math.round((settings.size.height * vw) / vh),
                settings.size.height,
              ];
        onStatus(`rendering ${total} frames…`);
        // Loaded here, on the export: the muxer behind it is the heaviest thing the editor could ship and the rarest it runs.
        const { exportScene } = await import("@studio/ui-eyes/export");
        const file = await exportScene(
          scene,
          {
            format,
            from,
            frameCount: total,
            ...(size ? { size } : {}),
            ...(settings.quality ? { quality: settings.quality } : {}),
            ...(track ? { audio: track } : {}),
          },
          // A frame count, not a percentage: a viewport export is slow and "1200 / 4500" is the
          // only progress that says how slow.
          (p) => {
            onStatus(`rendering ${p.frame} / ${p.total} frames…`);
            shown.progress(p.frame / p.total, `frame ${p.frame} / ${p.total}`);
          },
        );
        // Named by the container itself: mediabunny owns both strings, so the two cannot drift.
        download(
          new Blob([file.buffer], { type: file.mimeType }),
          `${name || "video"}${file.extension}`,
        );
        onStatus(`exported ${total} frames`);
        shown.end();
      } catch (e) {
        onStatus(`export failed: ${(e as Error).message}`);
        shown.end((e as Error).message);
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

  /** Share this project at a checkpoint and put its link on the clipboard — it ASKS first, naming what leaves (docs/shared.md). */
  const shareLink = useCallback(async () => {
    const agreed = await askConfirm({
      title: m["share.confirmTitle"](),
      body: m["share.confirmBody"](),
      confirmLabel: m["share.publishLink"](),
    });
    if (!agreed) return;
    setBusy(true);
    try {
      let p = await api.shareLinkStart();
      // The job runs on the file service; this only watches it, so a closed panel loses nothing but the bar.
      while (p && p.step !== "done" && p.step !== "failed") {
        setProgress(p);
        onStatus(shareProgressLine(p));
        await new Promise((r) => setTimeout(r, POLL_MS));
        p = await api.shareLinkProgress();
      }
      if (!p) throw new Error("the share was lost — try again");
      if (p.step === "failed") throw new Error(p.error ?? "");
      const url = shareUrl(window.location.origin, p.token ?? "");
      const mb = Math.round((p.bytes ?? 0) / 1048576);
      setProgress(null);
      try {
        await navigator.clipboard.writeText(url);
        onStatus(m["share.copied"]({ mb, url }));
      } catch {
        // A refused clipboard must not lose the link: it is the whole point of the command, and it exists exactly once.
        onStatus(m["share.done"]({ mb, url }));
      }
    } catch (e) {
      const error = (e as Error).message;
      setProgress({ step: "failed", done: 0, total: 0, error });
      onStatus(m["share.failed"]({ error }));
    } finally {
      setBusy(false);
    }
  }, [onStatus]);

  const exportTimeline = useCallback(
    async (
      project: string,
      format: TimelineFormat,
      lane: string | undefined,
      name: string,
      run: (line: string) => Promise<unknown>,
    ) => {
      setBusy(true);
      try {
        await run(`picture interchange ${format}${lane ? ` ${lane}` : ""}`);
        // The verb writes to one FIXED path, so nothing it said has to be parsed to find the file.
        const path = `${project === "." ? "" : `${project}/`}exports/cut.${format}`;
        const { content } = await api.read(path);
        download(
          new Blob([content], {
            type: format === "otio" ? "application/json" : "text/plain",
          }),
          `${name || "cut"}.${format}`,
        );
        onStatus(`exported ${name || "cut"}.${format}`);
      } catch (e) {
        onStatus(`export failed: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [onStatus],
  );

  return {
    busy,
    exportMix,
    exportVideo,
    exportTimeline,
    shareK7,
    shareLink,
    progress,
  };
}
