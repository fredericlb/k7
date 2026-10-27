// HuntProgress.tsx — ONE automatic download, followed from the add-song popin: who is sending, how many
// peers were tried, what was filed and where. The hunt lives on the server, so closing the popin stops
// only the watching. See ../docs/hunt.md.

import { Button } from "@frediverse/ui/button";
// Clapperboard and not a logo: lucide dropped its brand icons, and "a video" is what it is.
import {
  CheckCircle2,
  Clapperboard,
  Loader2,
  TriangleAlert,
} from "@frediverse/ui/icons";
import {
  canFallBackToYoutube,
  type HuntRecord,
} from "@studio/web-protocol/hunt";
import { useEffect, useRef, useState } from "react";
import { hunt } from "./api";
import { useLabels } from "./host";
import type { LibraryLabels } from "./labels";
import { poll } from "./poll";

/** Fast enough that a peer change shows, slow enough for a popin left open: a hunt lasts minutes. */
const POLL_MS = 2000;

/** What the hunt says about itself: who is sending while it downloads, why on failure, where once filed. */
function detail(h: HuntRecord, l: LibraryLabels["find"]): string {
  if (h.status === "failed") return h.error ?? l.failed;
  if (h.status === "searching") return l.searching;
  if (h.status === "downloading") {
    // The fallback goes through no peer: saying "waiting for a peer" would name the wrong machine.
    if (h.via === "youtube") return l.youtubeDownloading;
    const who = h.peer ? l.atPeer(h.peer) : l.waitingPeer;
    const tries = h.switches ? ` — ${l.peerTry(h.switches + 1)}` : "";
    return `${who}${tries}`;
  }
  const from = h.via === "youtube" ? "YouTube · " : "";
  return `${from}${h.error ?? h.path ?? l.filed}`;
}

/** The format obtained, said plainly: a 128 kbps that announces itself is not a mixing reference. */
function quality(h: HuntRecord): string | null {
  if (!h.format) return null;
  const ext = h.format.replace(/^\./, "").toUpperCase();
  return h.bitrate ? `${ext} ${h.bitrate} kbps` : ext;
}

export function HuntProgress({
  first,
  youtube,
  onFiled,
  onStatus,
}: {
  /** The row the start answered with, drawn until the first poll replaces it. */
  first: HuntRecord;
  /** Is yt-dlp there? If not, the fallback is greyed out and says why rather than failing on click. */
  youtube: boolean;
  /** Called once, when the song is filed, with its folder — so the screen behind can open it. */
  onFiled: (folder: string) => void;
  /** Every state it reaches, so the popin offers Stop while it runs and another way once it failed. */
  onStatus: (status: HuntRecord["status"]) => void;
}) {
  const l = useLabels().find;
  const [h, setH] = useState(first);
  const [error, setError] = useState<string | null>(null);
  const told = useRef(false);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  useEffect(() => statusRef.current(h.status), [h.status]);

  // Only while the popin is open: the hunt goes on without anyone watching.
  useEffect(() => {
    let stop = false;
    const tick = () =>
      hunt
        .list()
        .then((list) => {
          const row = list.hunts.find((x) => x.id === first.id);
          if (stop || !row) return;
          setH(row);
          if (row.status === "done" && !told.current) {
            told.current = true;
            // An "already filed" row names the master, not its folder (apps/k7/backend/docs/media/hunt.md).
            onFiled((row.path ?? "").replace(/\/original\.[^/]+$/, ""));
          }
        })
        .catch((e: Error) => !stop && setError(e.message));
    const end = poll(tick, POLL_MS);
    return () => {
      stop = true;
      end();
    };
  }, [first.id, onFiled]);

  const retryOnYoutube = () => {
    setError(null);
    // Blue at once, without waiting for the next poll: a click must show, or it is repeated.
    setH((x) => ({
      ...x,
      status: "downloading",
      via: "youtube",
      error: undefined,
    }));
    void hunt.youtube(h.id).catch((e: Error) => setError(e.message));
  };

  const q = quality(h);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-3 rounded-md border border-border bg-secondary/30 px-3 py-2">
        <span className="mt-0.5">
          {h.status === "done" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
          ) : h.status === "failed" ? (
            <TriangleAlert className="h-4 w-4 shrink-0 text-destructive" />
          ) : (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-500" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          {q && (
            <span className="mb-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {q}
            </span>
          )}
          <span className="block break-words text-xs text-muted-foreground">
            {detail(h, l)}
          </span>
        </span>
      </div>
      {/* The fallback, only once Soulseek is EXHAUSTED and never automatically (../docs/hunt.md). */}
      {canFallBackToYoutube(h) && (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          disabled={!youtube}
          title={youtube ? l.youtubeTitle : l.noYtdlp}
          onClick={retryOnYoutube}
        >
          <Clapperboard className="mr-1 h-3.5 w-3.5" /> {l.youtubeButton}
        </Button>
      )}
      {error && (
        <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
