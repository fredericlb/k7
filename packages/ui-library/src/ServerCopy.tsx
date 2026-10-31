// ServerCopy.tsx — on a machine paired with a server: where each entry lives (here, there, both), whether the server
// answers, and the download of an entry only the server holds — drawn in the tree among the rest. The same icons as
// k7's workspace list. Nothing at all on an unpaired machine or on the server itself. See ../../mediatek/docs/serverCopy.md.

import { Button } from "@frediverse/ui/button";
import {
  Cloud,
  CloudCheck,
  CloudDownload,
  HardDrive,
  Loader2,
} from "@frediverse/ui/icons";
import {
  downloadsSnapshot,
  isDownloading,
  queueDownload,
  subscribeDownloads,
} from "@studio/http-client/downloads";
import {
  FAMILIES,
  type Family,
  type LibraryPlacement,
  type MediatekEntry,
} from "@studio/mediatek/types";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { library, onServerUnreachable } from "./api";
import { serverBase } from "./config";
import { useLabels } from "./host";
import { missingUnder } from "./serverSets";
import type { SongPlace } from "./songSource";

/** The server is asked again this often, for what another machine uploaded there. */
const PLACEMENT_MS = 30_000;
/** Edits on the server come in bursts (an autosave): the local copy is refreshed once they settle. */
const REFRESH_MS = 5_000;

export type Placement = "synced" | "local";

/** The download manager's key for one family-prefixed path. */
export const downloadKey = (path: string): string => `library:${path}`;

/** What the manager names a song by: its path under the family, `artist/album/song`. */
const songLabel = (path: string): string =>
  path.split("/").slice(1).join(" / ");

/** The open family's placement, re-asked whenever the local listing reloads; null when there is nothing to say. */
export function useServerCopy(
  section: string,
  entries: MediatekEntry[] | null,
  onError: (message: string) => void,
) {
  const family = FAMILIES.includes(section as Family) ? section : null;
  const [placement, setPlacement] = useState<LibraryPlacement | null>(null);
  // Only where songs open from the server on demand (the phone): whether it answers decides what may be edited.
  const onDemand = serverBase() !== null;
  const [reachable, setReachable] = useState<boolean | null>(null);

  const recheck = useCallback(async () => {
    if (!onDemand) return;
    try {
      const s = await library.status();
      setReachable(s.paired ? s.reachable : null);
    } catch {
      // This machine's own backend not answering says nothing about the server.
    }
  }, [onDemand]);

  // A forwarded call meeting "cannot reach" says so at once; the next status poll says when it is back.
  useEffect(
    () =>
      onDemand ? onServerUnreachable(() => setReachable(false)) : undefined,
    [onDemand],
  );

  const reload = useCallback(async () => {
    void recheck();
    if (!family) return setPlacement(null);
    try {
      const p = await library.placement(family);
      setPlacement(p.paired ? p : null);
    } catch {
      // A server that does not answer this once keeps what it said before: its songs must not vanish from the page.
    }
  }, [family, recheck]);

  // Another section is another family: what the last one's server said is not this one's.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the family changing IS the signal.
  useEffect(() => setPlacement(null), [family]);

  // Keyed on `entries`: a local reload is when what is here changed.
  useEffect(() => {
    if (!entries) return;
    void reload();
    const t = setInterval(() => void reload(), PLACEMENT_MS);
    return () => clearInterval(t);
  }, [entries, reload]);

  // One queued entry per song, so the manager counts songs and each row spins alone (../../http-client/docs/downloads.md).
  const download = useCallback(
    async (paths: string[]) => {
      if (!family || !paths.length) return;
      const runs = paths.map((path) =>
        queueDownload(
          { key: downloadKey(path), kind: "song", label: songLabel(path) },
          // On demand a copy follows the server, whose edits it is then kept in step with.
          () => library.download(family, [path], onDemand),
        )
          // The local poll lists the new entry on its own; the placement is asked again at once.
          .then(() => reload()),
      );
      const failed = (await Promise.allSettled(runs)).find(
        (r) => r.status === "rejected",
      );
      if (failed) onError((failed.reason as Error).message);
    },
    [family, onError, reload, onDemand],
  );

  // The settle timers per song, so a burst of edits refreshes its copy once.
  const settling = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = settling.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);

  /** An edit landed on the server's version of `path`: its copy here comes down again, after one under way. */
  const refreshCopy = useCallback(
    (path: string) => {
      clearTimeout(settling.current.get(path));
      settling.current.set(
        path,
        setTimeout(() => {
          settling.current.delete(path);
          const key = downloadKey(path);
          const again = () => void download([path]);
          // The same key while one runs answers that run: the edit may have missed it, so another follows.
          if (isDownloading(downloadsSnapshot(), key))
            void queueDownload({ key, kind: "song", label: "" }, async () => {})
              .catch(() => {})
              .finally(again);
          else again();
        }, REFRESH_MS),
      );
    },
    [download],
  );

  const synced = useMemo(() => new Set(placement?.synced ?? []), [placement]);
  const serverOnly = useMemo(
    () => new Set((placement?.serverOnly ?? []).map((e) => e.path)),
    [placement],
  );
  return {
    placement,
    onDemand,
    /** Whether the server answers; null when unknown, unpaired, or not on demand. A stale listing says away. */
    reachable: placement?.stale ? false : reachable,
    /** Ask again now — what a forwarded call that could not reach the server does. */
    recheck,
    /** One local entry's state, or null when the machine is not paired. */
    stateOf: (path: string): Placement | null =>
      placement ? (synced.has(path) ? "synced" : "local") : null,
    /** Any entry's place, the server's own included; null when the machine is not paired. */
    placeOf: (path: string): SongPlace | null =>
      !placement
        ? null
        : serverOnly.has(path)
          ? "server"
          : synced.has(path)
            ? "synced"
            : "local",
    /** The server-only paths under a family-prefixed folder — what an album's download takes. */
    missingUnder: (folder: string): string[] =>
      placement ? missingUnder(placement.serverOnly, folder) : [],
    download,
    refreshCopy,
  };
}

/** One icon: synced with the server, on this machine only, or on the server only. */
export function PlacementIcon({
  state,
  server,
}: {
  state: SongPlace | null;
  server: string | null;
}) {
  const l = useLabels();
  if (!state) return null;
  const host = server ? new URL(server).host : "";
  const said =
    state === "synced"
      ? l.contents.synced(host)
      : state === "server"
        ? l.contents.serverOnly(host)
        : l.contents.localOnly;
  const Icon =
    state === "synced" ? CloudCheck : state === "server" ? Cloud : HardDrive;
  return (
    <span
      title={said}
      role="img"
      aria-label={said}
      className="inline-flex shrink-0 self-center"
    >
      <Icon
        className={`size-3.5 ${state === "synced" ? "text-emerald-500" : "text-muted-foreground"}`}
      />
    </span>
  );
}

/** The download of one entry of the server's alone, at the end of its tree row — its spinner while it comes down. */
export function RemoteDownload({
  path,
  onDownload,
}: {
  /** Family-prefixed, as the server names it. */
  path: string;
  onDownload: (paths: string[]) => Promise<void>;
}) {
  const l = useLabels();
  const all = useSyncExternalStore(subscribeDownloads, downloadsSnapshot);
  // Read off the manager's list: a right-click's "download missing" spins this row too.
  const busy = isDownloading(all, downloadKey(path));
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className="shrink-0 text-muted-foreground"
      title={l.contents.download}
      aria-label={l.contents.download}
      aria-busy={busy}
      disabled={busy}
      onClick={(e) => {
        // The row behind it must not take the click as its own.
        e.stopPropagation();
        void onDownload([path]);
      }}
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <CloudDownload className="size-3.5" />
      )}
    </Button>
  );
}
