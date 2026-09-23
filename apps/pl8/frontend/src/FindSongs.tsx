// FindSongs.tsx — "Trouver des morceaux": one search field, and under it the history of what has
// been asked for — green once filed, blue while running, red when it failed. A PAGE and not a
// dialog, because the history grows. See ../../docs/hunt.md.

import { Button } from "@frediverse/ui/button";
// Clapperboard and not a logo: lucide dropped its brand icons, and "a video" is what it is.
import {
  ArrowLeft,
  CheckCircle2,
  Clapperboard,
  Loader2,
  Search,
  TriangleAlert,
  X,
} from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import {
  canFallBackToYoutube,
  type HuntRecord,
  type HuntStatus,
} from "@studio/web-protocol/hunt";
import { useCallback, useEffect, useRef, useState } from "react";
import { hunt } from "./api";

/** Fast enough that a peer change shows, slow enough for a screen left open: a hunt lasts minutes. */
const POLL_MS = 2000;

/** Three colours for four states: searching and downloading both read as "running" to a watcher. */
const TONE: Record<HuntStatus, string> = {
  done: "border-l-emerald-500",
  searching: "border-l-sky-500",
  downloading: "border-l-sky-500",
  failed: "border-l-destructive",
};

function Icon({ status }: { status: HuntStatus }) {
  if (status === "done")
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />;
  if (status === "failed")
    return <TriangleAlert className="h-4 w-4 shrink-0 text-destructive" />;
  return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-500" />;
}

/** What the row says about itself: who is sending while it downloads, why on failure, where once filed. */
function detail(h: HuntRecord): string {
  if (h.status === "failed") return h.error ?? "échec";
  if (h.status === "searching") return "recherche du morceau…";
  if (h.status === "downloading") {
    // The fallback goes through no peer: saying "waiting for a peer" would name the wrong machine.
    if (h.via === "youtube") return "téléchargement depuis YouTube…";
    const who = h.peer ? `chez ${h.peer}` : "en attente d'un pair";
    const tries = h.switches ? ` — ${h.switches + 1}ᵉ pair essayé` : "";
    return `${who}${tries}`;
  }
  const from = h.via === "youtube" ? "YouTube · " : "";
  return `${from}${h.error ?? h.path ?? "rangé"}`;
}

/** The format obtained, said plainly: a 128 kbps that announces itself is not a mixing reference. */
function quality(h: HuntRecord): string | null {
  if (!h.format) return null;
  const ext = h.format.replace(/^\./, "").toUpperCase();
  return h.bitrate ? `${ext} ${h.bitrate} kbps` : ext;
}

function Row({
  h,
  youtube,
  onForget,
  onYoutube,
}: {
  h: HuntRecord;
  /** Is yt-dlp there? If not, the fallback is greyed out and says why rather than failing on click. */
  youtube: boolean;
  onForget: (id: string) => void;
  onYoutube: (id: string) => void;
}) {
  const named = h.artist && h.title ? `${h.artist} — ${h.title}` : h.query;
  const q = quality(h);
  return (
    <li
      className={`flex items-start gap-3 border-l-2 ${TONE[h.status]} bg-secondary/30 px-3 py-2`}
    >
      <span className="mt-0.5">
        <Icon status={h.status} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="truncate text-sm font-medium">{named}</span>
          {h.album && (
            <span className="truncate text-xs text-muted-foreground">
              {h.album}
              {h.date ? ` · ${h.date.slice(0, 4)}` : ""}
            </span>
          )}
          {q && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {q}
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {detail(h)}
        </span>
      </span>
      {/* The fallback, only once Soulseek is EXHAUSTED and never automatically (../docs/hunt.md). */}
      {canFallBackToYoutube(h) && (
        <Button
          variant="secondary"
          size="xs"
          className="shrink-0"
          disabled={!youtube}
          title={
            youtube
              ? "Récupérer ce morceau sur YouTube (audio compressé)"
              : "yt-dlp n'est pas installé sur ce serveur"
          }
          onClick={() => onYoutube(h.id)}
        >
          <Clapperboard className="mr-1 h-3.5 w-3.5" /> DL sur YouTube
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        title={
          h.status === "searching" || h.status === "downloading"
            ? "Abandonner cette recherche"
            : "Retirer de l'historique"
        }
        onClick={() => onForget(h.id)}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}

export function FindSongs({
  onBack,
  onFiled,
  onOpenSettings,
}: {
  onBack: () => void;
  /** Where the reason below is fixed: the instance's slskd settings live there. */
  onOpenSettings: () => void;
  /** Called when a row turns green, so the catalogue behind reloads without waiting for its poll. */
  onFiled: () => void;
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<HuntRecord[] | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [youtube, setYoutube] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // WHICH rows were filed, not how many: a counter would return to its old value on the next song.
  const filed = useRef<Set<string> | null>(null);

  // Only while the page is mounted: a hunt lives on the server, so polling for nobody costs a round trip.
  useEffect(() => {
    let stop = false;
    const tick = () =>
      void hunt
        .list()
        .then((l) => {
          if (stop) return;
          setRows(l.hunts);
          setReason(l.configured ? null : l.reason);
          setYoutube(l.youtube);
          const done = new Set(
            l.hunts.filter((h) => h.status === "done").map((h) => h.id),
          );
          // The first pass refreshes nothing: everything is new and the catalogue just loaded.
          if (filed.current && [...done].some((id) => !filed.current?.has(id)))
            onFiled();
          filed.current = done;
        })
        .catch((e: Error) => !stop && setError(e.message));
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [onFiled]);

  const submit = useCallback(() => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    void hunt
      .start(q)
      // Cleared at once: a library is built one title after another, and clearing by hand is one gesture too many.
      .then((h) => {
        setQuery("");
        setRows((r) => [h, ...(r ?? [])]);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  }, [query, busy]);

  const forget = useCallback((id: string) => {
    setRows((r) => (r ?? []).filter((h) => h.id !== id));
    void hunt.forget(id).catch(() => {});
  }, []);

  const retryOnYoutube = useCallback((id: string) => {
    setError(null);
    // The row turns blue without waiting for the next poll: a click must show, or it is repeated.
    setRows((r) =>
      (r ?? []).map((h) =>
        h.id === id
          ? { ...h, status: "downloading", via: "youtube", error: undefined }
          : h,
      ),
    );
    void hunt.youtube(id).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The field stays AT THE TOP and does not scroll: a library is built one title after another. */}
      <div className="shrink-0 border-b border-border px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Morceaux
          </Button>
          {/* Focus on load: the click that opened this page is already the request to type. */}
          <Input
            autoFocus
            className="h-12 flex-1 text-base"
            placeholder="artiste et titre — « nirvana lithium »"
            value={query}
            disabled={Boolean(reason)}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <Button
            size="lg"
            onClick={submit}
            disabled={busy || !query.trim() || Boolean(reason)}
          >
            {busy ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-1 h-4 w-4" />
            )}
            Chercher
          </Button>
        </div>

        {/* Said rather than hidden: an unconfigured deployment is this page's normal state. */}
        {reason && (
          <div className="mx-auto mt-3 flex max-w-4xl items-center justify-between gap-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
            <span>{reason}</span>
            <Button variant="outline" size="sm" onClick={onOpenSettings}>
              Paramètres
            </Button>
          </div>
        )}
        {error && (
          <p className="mx-auto mt-3 max-w-4xl rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        <div className="mx-auto max-w-4xl">
          {rows === null ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              chargement…
            </p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Rien encore. Tapez un artiste et un titre : le morceau est
              identifié, cherché sur le réseau, puis rangé tout seul.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {rows.map((h) => (
                <Row
                  key={h.id}
                  h={h}
                  youtube={youtube}
                  onForget={forget}
                  onYoutube={retryOnYoutube}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
