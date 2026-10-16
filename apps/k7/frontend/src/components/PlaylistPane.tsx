// PlaylistPane.tsx — the right half of a playlist's screen: its lines resolved against the
// songs the médiathèque holds, each one playable, and one way of putting another one there —
// search the catalogue, pl8 being where a song ARRIVES. Named for the pane and not for the
// lines, which are `@studio/mediatek/playlistItems` — shared with the DJ desk, which resolves
// the same lines. See ../docs/playlists.md.

import { Button } from "@frediverse/ui/button";
import {
  AudioLines,
  ChevronDown,
  ChevronUp,
  Disc3,
  FileQuestion,
  Library,
  ListMusic,
  Pause,
  Play,
  Plus,
  Search,
  Split,
  X,
} from "@frediverse/ui/icons";
import {
  itemLabel,
  itemProblem,
  packSongDrag,
  type ResolvedItem,
  resolveItems,
  SONG_DRAG_TYPE,
  songMatches,
  songRef,
} from "@studio/mediatek/playlistItems";
import type { MediatekEntry } from "@studio/mediatek/types";
import { cfg } from "@studio/project-shell/fileApi";
import type { PlaylistItem } from "@studio/song-schema/playlist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, mediatek } from "../api";
import { desktop } from "../desktop";
import { parts } from "../i18nParts";
import { m } from "../paraglide/messages.js";
import { MEDIA_ROUTE, pl8Url } from "../projects/api";
import { type Run, StemsBar } from "./StemsBar";

/** How many search hits are drawn at once: three hundred morceaux in one scrolling box is not a list you read, so the field is the way through. */
const MAX_HITS = 40;

/** How often a running separation is asked how it is getting on — it reports per WINDOW, so anything faster asks the same number twice. */
const PREP_POLL_MS = 2000;

export function PlaylistPane({
  items,
  songs,
  onAdd,
  addRefusal,
  onRemove,
  onMove,
  editRefusal,
  onRun,
}: {
  /** The lines, as the text on the left currently parses. */
  items: PlaylistItem[];
  /** The songs family, or null before its listing has arrived. */
  songs: MediatekEntry[] | null;
  /** Put a line at the end of the playlist: a request upwards rather than a write, since the EDITOR owns the text. */
  onAdd: (item: PlaylistItem) => void;
  /** Why `onAdd` would not work right now — the file's `items:` is in a shape the text-level append cannot extend. */
  addRefusal?: string;
  /** Drop the line at a position — upwards for the same reason `onAdd` is; absent drops the buttons. */
  onRemove?: (index: number) => void;
  /** Move a line, both positions 0-based — the pane counts from 1 only where it PRINTS. */
  onMove?: (from: number, to: number) => void;
  /** Why those two would not work — the same kind of fact as `addRefusal`, about a shape text cannot reorder. */
  editRefusal?: string;
  /** Dispatch a command line — the stem bar sends you to the settings with one; absent drops the button and keeps the sentence. */
  onRun?: (line: string) => Promise<void>;
}) {
  const rows = useMemo(() => resolveItems(items, songs), [items, songs]);

  /** The transport, and the whole of it: one element playing one file, this shell already having a transport of its own. */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Which line this pane started, or null. */
  const [current, setCurrent] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  /** What the footer says about a click that did not start anything. Cleared by the next one. */
  const [notice, setNotice] = useState("");

  /** The audio inside the song's folder, when the row resolved to a version that HAS one. */
  const fileOf = useCallback(
    (r: ResolvedItem): string | null =>
      r.song && r.take?.file ? `${r.song.path}/${r.take.file}` : null,
    [],
  );

  /** Start the first line from `from` that has audio, or stop if none has — skipping only ever over a RESOLUTION problem. */
  const startAt = useCallback(
    (from: number) => {
      setNotice("");
      for (let i = from; i < rows.length; i++) {
        const file = fileOf(rows[i] as ResolvedItem);
        if (!file) continue;
        const el = audioRef.current;
        if (!el) return;
        el.src = mediatek.songUrl(file);
        setCurrent(i);
        void el.play().catch((e: Error) => setNotice(e.message));
        return;
      }
      setCurrent(null);
      if (from === 0) setNotice(m["pl.noAudioRow"]());
    },
    [rows, fileOf],
  );

  const toggleRow = useCallback(
    (i: number) => {
      const el = audioRef.current;
      // The row that is already going: pause/resume rather than restart, so the position keeps.
      if (el && current === i) {
        if (el.paused) void el.play().catch(() => {});
        else el.pause();
        return;
      }
      startAt(i);
    },
    [current, startAt],
  );

  const playable = rows.filter((r) => fileOf(r)).length;

  // --- adding ----------------------------------------------------------------------

  // Where the catalogue's songs open, for the link at the foot: a full page on the desktop's paired server, or on this origin when hosted.
  const [catalogue, setCatalogue] = useState<string | null>(pl8Url());
  useEffect(() => {
    void desktop.state().then((d) => {
      // Hosted, pl8 is this same origin; on the desktop it is the server's, or nowhere.
      setCatalogue(d ? (d.server ? pl8Url(d.server) : null) : pl8Url());
    });
  }, []);
  // A full-page load and not the router's: this pane's basename is the project, the media pages are the home's.
  const songsPage = catalogue ? `${catalogue}${MEDIA_ROUTE}/songs` : null;

  // One act here — SEARCH, over songs the media library already holds; filing a new one is its own screen, linked at the foot of the list.
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const queryRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searching) queryRef.current?.focus();
  }, [searching]);

  const hits = useMemo(
    () => (songs ?? []).filter((e) => songMatches(e, query)),
    [songs, query],
  );

  const add = useCallback(
    (song: MediatekEntry, variant?: string) => {
      onAdd({ song: songRef(song), ...(variant ? { variant } : {}) });
    },
    [onAdd],
  );

  const cannotAdd =
    addRefusal || (songs === null ? m["pl.songsNotLoaded"]() : "");

  // --- separating the whole set list --------------------------------------------------

  // The same work as `playlist stems`, driven from here so it can be WATCHED — and SEQUENTIAL, two at once on one machine finishing no sooner.
  const [separating, setSeparating] = useState(false);
  /** The chain THIS MACHINE separates with, or null when it has never been told — read and never asked for (`system stems`). */
  const [chain, setChain] = useState<string | null | undefined>(undefined);
  const [run, setRun] = useState<Run | null>(null);
  /** Read by the loop between two songs and between two polls — a ref, the loop being closed over the render it started in. */
  const stopRef = useRef(false);
  // The loop outlives this component being closed, so leaving is the same event as Stop; the SEPARATION itself runs to the end.
  useEffect(
    () => () => {
      stopRef.current = true;
    },
    [],
  );

  // Asked for when the bar opens rather than on mount, and re-asked on every opening: the settings panel is one click away.
  useEffect(() => {
    if (!separating) return;
    api
      .preferences()
      .then((p) => setChain(p.stemsChain))
      // A file service that will not answer is not a machine with no chain, but the button can do nothing either way.
      .catch(() => setChain(null));
  }, [separating]);

  /** Separate every line that has audio, one after another: a missing SONG is a note and the loop goes on, a refused RUN stops everything. */
  const separateAll = useCallback(async () => {
    const targets = rows
      .map((r) => ({ path: fileOf(r), label: itemLabel(r) }))
      .filter((t): t is { path: string; label: string } => !!t.path);
    stopRef.current = false;
    const notes: string[] = [];
    let done = 0;
    let skipped = 0;
    const say = (label: string, percent: number | null, over = false) =>
      setRun({
        total: targets.length,
        done,
        label,
        percent,
        skipped,
        notes: [...notes],
        over,
      });
    if (!targets.length) return say("", null, true);

    for (const t of targets) {
      if (stopRef.current) break;
      say(t.label, null);
      try {
        const first = await mediatek.prepareStems(t.path, cfg().engineId);
        if (first.ready) {
          skipped += 1;
          done += 1;
          continue;
        }
        let job = first.job;
        while (job && !job.done) {
          say(t.label, job.percent);
          await new Promise((r) => setTimeout(r, PREP_POLL_MS));
          if (stopRef.current) break;
          try {
            job = await mediatek.separation(job.id);
          } catch {
            // The registry sweeps a finished job after five minutes, so a poll that 404s is usually a run that landed.
            const again = await mediatek.prepareStems(t.path, cfg().engineId);
            if (again.ready) break;
            job = again.job;
          }
        }
        if (job?.failed)
          notes.push(`${t.label} : ${job.error ?? m["pl.jobFailed"]()}`);
        done += 1;
      } catch (e) {
        const err = e as Error & { status?: number };
        notes.push(`${t.label} : ${err.message}`);
        // Not this song's problem but the run's — see the docblock.
        if (err.status === 400 || err.status === 409) break;
        done += 1;
      }
    }
    say("", null, true);
  }, [rows, fileOf]);

  return (
    <section className="flex h-full min-h-0 flex-col">
      {/* Off screen and never controlled by React: a `<audio>` re-rendered with a new src prop restarts what is playing. */}
      <audio
        ref={audioRef}
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        // The next line begins where this one ended; only ours can end, this element being this pane's alone.
        onEnded={() => current !== null && startAt(current + 1)}
        onError={() => setNotice(m["pl.wontPlay"]())}
      >
        <track kind="captions" />
      </audio>

      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Button
          size="sm"
          variant={searching ? "default" : "secondary"}
          disabled={!!cannotAdd}
          title={cannotAdd}
          onClick={() => setSearching((s) => !s)}
        >
          <Search className="mr-1 h-4 w-4" /> Chercher un morceau
        </Button>
        {/* The night-before job, here rather than on the desk because it is about the SET LIST and not about one record. */}
        <Button
          size="sm"
          variant={separating ? "default" : "secondary"}
          disabled={!playable}
          title={
            playable ? m["pl.separateHint"]() : m["pl.nothingToSeparate"]()
          }
          onClick={() => setSeparating((s) => !s)}
        >
          <Split className="mr-1 h-4 w-4" /> {m["pl.separate"]()}
        </Button>
        <span className="text-xs text-muted-foreground">
          {m["pl.rowCount"]({
            n: rows.length,
            s: rows.length > 1 ? "s" : "",
          })}
          {playable === rows.length
            ? ""
            : ` · ${m["pl.playableCount"]({ n: playable })}`}
        </span>
      </header>

      {/* The separation bar, above the list like the search: what it is working through stays visible under it. */}
      {separating ? (
        <StemsBar
          chain={chain}
          playable={playable}
          run={run}
          onStart={() => void separateAll()}
          onStop={() => {
            stopRef.current = true;
          }}
          onSettings={onRun && (() => void onRun("ui settings io"))}
          onClose={() => setSeparating(false)}
        />
      ) : null}

      {/* The search, above the list and not over it: watching the set list grow as you pick is the only confirmation there is. */}
      {searching ? (
        <div className="flex max-h-[55%] min-h-0 shrink-0 flex-col border-b bg-muted/30">
          <div className="flex shrink-0 items-center gap-2 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={queryRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // The shell binds bare keys; a search field must keep its own.
                e.stopPropagation();
                // Escape closes without adding; Enter takes the first hit, which is what 'type three letters and press return' expects.
                if (e.key === "Escape") return setSearching(false);
                if (e.key === "Enter" && hits[0]) add(hits[0] as MediatekEntry);
              }}
              placeholder={m["pl.searchPlaceholder"]()}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {hits.length}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              aria-label={m["pl.closeSearch"]()}
              onClick={() => setSearching(false)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <ul className="min-h-0 flex-1 overflow-auto px-2 pb-2">
            {hits.length === 0 ? (
              <li className="px-2 py-3 text-sm text-muted-foreground">
                {m["pl.noHit"]()}
              </li>
            ) : (
              hits.slice(0, MAX_HITS).map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/40"
                >
                  <Disc3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {/* The whole row adds the MASTER, which is what a click on a song means; the chips beside it name a version instead. */}
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left"
                    onClick={() => add(s)}
                  >
                    {s.name}
                    {s.meta?.artist ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {String(s.meta.artist)}
                      </span>
                    ) : null}
                  </button>
                  {/* A song's other versions, one click each: the playlist format exists to carry that mapping, so nobody types it by hand. */}
                  {(s.variants ?? []).map((v) => (
                    <button
                      key={v.name}
                      type="button"
                      title={m["pl.addVariant"]({ name: v.name })}
                      className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      onClick={() => add(s, v.name)}
                    >
                      {v.name}
                    </button>
                  ))}
                  <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </li>
              ))
            )}
            {/* Never a silent cap: a search that quietly hid the song you wanted is worse than one that says to type another word. */}
            {hits.length > MAX_HITS ? (
              <li className="px-2 py-1.5 text-xs text-muted-foreground">
                {m["pl.moreHits"]({ n: hits.length - MAX_HITS })}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {rows.length === 0 ? (
          <div className="flex flex-col items-start gap-3 p-4">
            <p className="text-sm text-muted-foreground">
              {parts((h) => m["pl.emptyBody"](h), {
                items: <span className="font-mono">items:</span>,
              })}
            </p>
            {/* The empty state is where the header's button is most needed and least findable, so it is offered again here. */}
            {searching ? null : (
              <Button
                size="sm"
                variant="secondary"
                disabled={!!cannotAdd}
                title={cannotAdd}
                onClick={() => setSearching(true)}
              >
                <Search className="mr-1 h-4 w-4" /> Chercher un morceau
              </Button>
            )}
          </div>
        ) : (
          <ol className="flex flex-col">
            {rows.map((r, i) => {
              const problem = itemProblem(r, songs !== null);
              // Resolved to a version whose file the folder has not got — a different sentence from a variant that does not exist.
              const missing = !problem && r.take?.kind === "missing";
              const playingHere = current === i && playing;
              const loadedHere = current === i;
              return (
                <li
                  // The index IS the identity: a playlist may name the same song twice, and keying on the ref would make those one row.

                  // biome-ignore lint/suspicious/noArrayIndexKey: see above
                  key={i}
                  // Draggable onto a DECK — the line travels, not the song, see packages/k7-plugins/docs/turntables/setList.md.
                  draggable={!problem && !missing}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      SONG_DRAG_TYPE,
                      packSongDrag({
                        song: r.item.song,
                        ...(r.item.variant ? { variant: r.item.variant } : {}),
                      }),
                    );
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  className={`group/row flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                    loadedHere ? "bg-accent/60" : "hover:bg-accent/30"
                  } ${!problem && !missing ? "cursor-grab active:cursor-grabbing" : ""}`}
                >
                  <span className="w-6 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    disabled={!!problem || missing}
                    title={problem || (missing ? m["pl.fileMissing"]() : "")}
                    onClick={() => toggleRow(i)}
                  >
                    {playingHere ? (
                      <Pause className="h-3.5 w-3.5" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  {r.take?.kind === "missing" ? (
                    <FileQuestion className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : r.take?.kind === "file" ? (
                    <AudioLines className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Disc3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {itemLabel(r)}
                  </span>
                  {r.song?.meta?.artist ? (
                    <span className="shrink-0 truncate text-xs text-muted-foreground">
                      {String(r.song.meta.artist)}
                    </span>
                  ) : null}
                  {/* Already separated, so the night-before run will skip it — the catalogue's own flag, a `stems/` folder seen by the scan. */}
                  {r.song?.meta?.stems ? (
                    <span
                      className="shrink-0 text-muted-foreground"
                      title={m["pl.alreadySplit"]()}
                    >
                      <Split className="h-3.5 w-3.5" />
                    </span>
                  ) : null}
                  {/* What the line names when it is not what the row shows, so a ref resolved by NAME still says which path it landed on. */}
                  {problem ? (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-destructive">
                      {problem}
                    </span>
                  ) : missing ? (
                    <span
                      className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-destructive"
                      title={m["pl.sidecarMissing"]()}
                    >
                      {m["pl.missing"]()}
                    </span>
                  ) : null}
                  {/* The running order and what is on it: the two acts that used to mean opening the YAML. */}
                  {onMove || onRemove ? (
                    <span className="flex shrink-0 items-center opacity-0 focus-within:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100">
                      {onMove ? (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            disabled={i === 0 || !!editRefusal}
                            title={editRefusal || m["pl.moveUp"]()}
                            onClick={() => onMove(i, i - 1)}
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            disabled={i === rows.length - 1 || !!editRefusal}
                            title={editRefusal || m["pl.moveDown"]()}
                            onClick={() => onMove(i, i + 1)}
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : null}
                      {onRemove ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 hover:text-destructive"
                          disabled={!!editRefusal}
                          title={editRefusal || m["pl.removeRow"]()}
                          onClick={() => {
                            // The row playing IS this one: silence it before the line under the transport goes.
                            if (current === i) {
                              audioRef.current?.pause();
                              setCurrent(null);
                            }
                            onRemove(i);
                          }}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
        {/* Where a song ARRIVES, at the foot of the list: on the desktop it is the SERVER's media pages, in the system browser. */}
        {songsPage ? (
          <a
            href={songsPage}
            {...(desktop.isDesktop
              ? { target: "_blank", rel: "noreferrer" }
              : {})}
            className="mt-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/30 hover:text-foreground"
            title={m["pl.catalogueHint"]()}
          >
            <Library className="h-3.5 w-3.5 shrink-0" />
            {m["pl.addSongs"]()}
          </a>
        ) : (
          <p className="mt-2 flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
            <Library className="h-3.5 w-3.5 shrink-0" />
            {m["pl.pairServer"]()}
          </p>
        )}
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t px-3 py-1 text-xs text-muted-foreground">
        <ListMusic className="h-3.5 w-3.5" />
        <span className="min-w-0 flex-1 truncate">
          {notice ||
            (current !== null && rows[current]
              ? m["pl.playing"]({
                  label: itemLabel(rows[current] as ResolvedItem),
                })
              : m["pl.footerHint"]())}
        </span>
      </footer>
    </section>
  );
}
