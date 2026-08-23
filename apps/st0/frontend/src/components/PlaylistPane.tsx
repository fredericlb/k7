// PlaylistPane.tsx — the right half of a playlist's screen: its lines resolved against the
// songs the médiathèque holds, each one playable, and the two ways of putting another one
// there — upload a file, or search the catalogue. Named for the pane and not for the lines,
// which are `@studio/mediatek/playlistItems` — shared with the DJ desk, which resolves the
// same lines. See ../docs/playlists.md.

import { Button } from "@frediverse/ui/button";
import { AUDIO_ACCEPT } from "@studio/mediatek/media";
import {
  itemLabel,
  itemProblem,
  type ResolvedItem,
  resolveItems,
  songMatches,
  songRef,
} from "@studio/mediatek/playlistItems";
import { tagsFromFilename } from "@studio/mediatek/song";
import type { MediatekEntry } from "@studio/mediatek/types";
import { cfg } from "@studio/project-shell/fileApi";
import type { PlaylistItem } from "@studio/song-schema/playlist";
import {
  AudioLines,
  Disc3,
  FileQuestion,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Plus,
  Search,
  Split,
  Square,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, mediatek } from "../api";

/** How many search hits are drawn at once: three hundred morceaux in one scrolling box is not a list you read, so the field is the way through. */
const MAX_HITS = 40;

/** How often a running separation is asked how it is getting on — it reports per WINDOW, so anything faster asks the same number twice. */
const PREP_POLL_MS = 2000;

/** Separating the whole set list, as it is going — one object, since every tick moves several of these and a half-updated bar lies. */
interface Run {
  /** Lines with audio to separate, and how many are behind us. */
  total: number;
  done: number;
  /** What is being worked on now, and how far its job says it is. */
  label: string;
  percent: number | null;
  /** Already prepared, so nothing was spent on them — counted apart from `done`, which is what makes a re-run cheap. */
  skipped: number;
  /** One line per song that could not be done — never a reason to stop the other eleven. */
  notes: string[];
  /** Set when the loop has left, whether it finished, was stopped or gave up. */
  over: boolean;
}

export function PlaylistPane({
  items,
  songs,
  onAdd,
  onFiled,
  addRefusal,
  onRun,
}: {
  /** The lines, as the text on the left currently parses. */
  items: PlaylistItem[];
  /** The songs family, or null before its listing has arrived. */
  songs: MediatekEntry[] | null;
  /** Put a line at the end of the playlist: a request upwards rather than a write, since the EDITOR owns the text. */
  onAdd: (item: PlaylistItem) => void;
  /** A song has just landed in the médiathèque: re-read the catalogue, or the line just written sits on 'morceau introuvable'. */
  onFiled: () => void;
  /** Why `onAdd` would not work right now — the file's `items:` is in a shape the text-level append cannot extend. */
  addRefusal?: string;
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
      if (from === 0) setNotice("aucune ligne de cette playlist n'a d'audio");
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

  // Two buttons, because they are two acts: SEARCH is a morceau you already have, UPLOAD a file on your disk — and the search stays OPEN after a click.
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

  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState("");
  const [uploadError, setUploadError] = useState("");

  /** A file from the disk: into the médiathèque FIRST, then onto this playlist — the line is written from the path it ANSWERS with. */
  const upload = useCallback(
    async (file: File) => {
      setUploadError("");
      setUploading(file.name);
      try {
        const guess = tagsFromFilename(file.name);
        const filed = await mediatek.addSong(file, {
          artist: guess.artist ?? "",
          album: guess.album ?? "",
          title: guess.title ?? "",
        });
        onAdd({ song: filed.path.replace(/^songs\//, "") });
        // The catalogue moved under us and this pane noticed: ask for it again, or the new line stays 'morceau introuvable'.
        onFiled();
      } catch (e) {
        // Including the 409: the song is already filed, but without the answer we do not know WHERE, and guessing is that second spelling.
        setUploadError((e as Error).message);
      } finally {
        setUploading("");
      }
    },
    [onAdd, onFiled],
  );

  const cannotAdd =
    addRefusal || (songs === null ? "morceaux pas encore chargés" : "");

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
        if (job?.failed) notes.push(`${t.label} : ${job.error ?? "échec"}`);
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
        onError={() => setNotice("ce fichier ne se lit pas dans ce navigateur")}
      >
        <track kind="captions" />
      </audio>

      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={!playable}
          onClick={() => startAt(0)}
        >
          <Play className="mr-1 h-4 w-4" /> Tout jouer
        </Button>
        {/* One verb for the file on your disk and one for the catalogue, so neither hides behind the other's menu. */}
        <Button
          size="sm"
          variant="secondary"
          disabled={!!addRefusal || !!uploading}
          title={addRefusal}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-1 h-4 w-4" />
          )}
          Ajouter un morceau
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept={AUDIO_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            // Cleared so the SAME file picked twice fires again — an unchanged value raises no event.
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
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
            playable
              ? "Séparer chaque morceau en batterie / basse / reste / voix, pour pouvoir en retirer un sur le pupitre"
              : "aucune ligne de cette playlist n'a d'audio à séparer"
          }
          onClick={() => setSeparating((s) => !s)}
        >
          <Split className="mr-1 h-4 w-4" /> Séparer les stems
        </Button>
        <span className="text-xs text-muted-foreground">
          {rows.length} ligne{rows.length > 1 ? "s" : ""}
          {playable === rows.length ? "" : ` · ${playable} jouable(s)`}
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

      {uploading ? (
        <p className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">
          envoi de « {uploading} » à la médiathèque…
        </p>
      ) : null}
      {uploadError ? (
        <p className="shrink-0 border-b px-3 py-2 text-xs text-destructive">
          {uploadError}
        </p>
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
              placeholder="titre, artiste, album…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {hits.length}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              aria-label="Fermer la recherche"
              onClick={() => setSearching(false)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <ul className="min-h-0 flex-1 overflow-auto px-2 pb-2">
            {hits.length === 0 ? (
              <li className="px-2 py-3 text-sm text-muted-foreground">
                Aucun morceau ne répond à ça.
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
                      title={`ajouter la variante « ${v.name} »`}
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
                …et {hits.length - MAX_HITS} autres — précisez la recherche
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {rows.length === 0 ? (
          <div className="flex flex-col items-start gap-3 p-4">
            <p className="text-sm text-muted-foreground">
              Cette playlist ne nomme aucun morceau. Cherchez-en un dans la
              médiathèque, déposez-en un depuis le disque, ou écrivez les lignes
              sous <span className="font-mono">items:</span> à gauche — c'est le
              même fichier.
            </p>
            {/* The empty state is where the header's buttons are most needed and least findable, so they are offered again here. */}
            {searching ? null : (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!!addRefusal || !!uploading}
                  title={addRefusal}
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload className="mr-1 h-4 w-4" /> Ajouter un morceau
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!!cannotAdd}
                  title={cannotAdd}
                  onClick={() => setSearching(true)}
                >
                  <Search className="mr-1 h-4 w-4" /> Chercher un morceau
                </Button>
              </div>
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
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                    loadedHere ? "bg-accent/60" : "hover:bg-accent/30"
                  }`}
                >
                  <span className="w-6 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    disabled={!!problem || missing}
                    title={problem || (missing ? "fichier introuvable" : "")}
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
                  {/* What the line names when it is not what the row shows, so a ref resolved by NAME still says which path it landed on. */}
                  {problem ? (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-destructive">
                      {problem}
                    </span>
                  ) : missing ? (
                    <span
                      className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-destructive"
                      title="le sidecar déclare ce fichier et le dossier ne l'a pas"
                    >
                      introuvable
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t px-3 py-1 text-xs text-muted-foreground">
        <ListMusic className="h-3.5 w-3.5" />
        <span className="min-w-0 flex-1 truncate">
          {notice ||
            (current !== null && rows[current]
              ? `en cours : ${itemLabel(rows[current] as ResolvedItem)}`
              : "les lignes se jouent d'affilée ; les morceaux sont ceux de la médiathèque")}
        </span>
      </footer>
    </section>
  );
}

/** Preparing the whole set list: which chain, and how far it has got — a bar rather than a dialogue, since this runs for an hour. */
function StemsBar({
  chain,
  playable,
  run,
  onStart,
  onStop,
  onSettings,
  onClose,
}: {
  /** The chain this MACHINE separates with: `null` for 'never told', `undefined` while the preference is being read. */
  chain: string | null | undefined;
  /** How many lines have audio — what the run will actually go through. */
  playable: number;
  run: Run | null;
  onStart: () => void;
  onStop: () => void;
  /** Open the settings, where the chain is set. Absent in a host with no command bar. */
  onSettings?: () => void;
  onClose: () => void;
}) {
  const busy = !!run && !run.over;
  /** The bar's fill, 0..1 — songs finished PLUS how far into the one in hand, neither half being honest alone. */
  const at = run
    ? Math.min(1, (run.done + (run.percent ?? 0) / 100) / (run.total || 1))
    : 0;

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2">
        <Split className="h-4 w-4 shrink-0 text-muted-foreground" />
        {/* WHICH chain separates is one answer for the machine, set once by `system stems` and only shown here (docs/playlists.md). */}
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {chain === undefined ? "…" : (chain ?? "aucune chaîne")}
        </span>
        {busy ? (
          <Button size="sm" variant="secondary" onClick={onStop}>
            <Square className="mr-1 h-3.5 w-3.5" /> Arrêter
          </Button>
        ) : (
          <Button size="sm" disabled={!chain || !playable} onClick={onStart}>
            Lancer ({playable})
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          aria-label="Fermer"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Told nothing yet: the one sentence that unblocks it, and the way there — not a picker, the machine being asked once. */}
      {chain === null ? (
        <p className="text-xs text-muted-foreground">
          Cette machine ne sait pas encore séparer. Choisissez la chaîne une
          fois dans les réglages, sous I/O — ou{" "}
          <span className="font-mono">system stems @st0/stems</span>.
          {onSettings ? (
            <Button
              size="sm"
              variant="secondary"
              className="ml-2 h-6"
              onClick={onSettings}
            >
              Réglages
            </Button>
          ) : null}
        </p>
      ) : null}

      {/* Before anything has been asked for: what this costs, said up front rather than found out by watching twelve songs run. */}
      {run || chain === null ? null : (
        <p className="text-xs text-muted-foreground">
          Chaque morceau prend plusieurs minutes, un à la fois. Ceux qui sont
          déjà séparés sont sautés, et une séparation interrompue reprend là où
          elle en était — relancer ne coûte rien.
        </p>
      )}

      {run ? (
        <>
          {/* A div with the role rather than a <progress>: the native element cannot be drawn as this shell's flat rule. */}
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={run.total}
            aria-valuenow={run.done}
            className="h-1 w-full overflow-hidden rounded bg-border"
          >
            <div
              className="h-full bg-foreground transition-[width] duration-300"
              style={{ width: `${Math.round(at * 100)}%` }}
            />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {run.over
              ? `terminé : ${run.done}/${run.total}` +
                (run.skipped ? ` · ${run.skipped} déjà séparé(s)` : "")
              : `${run.done + 1}/${run.total} · ${run.label}` +
                (run.percent == null ? " …" : ` · ${run.percent}%`)}
          </p>
          {/* Never swallowed: a song the machine has not pulled is exactly what somebody needs to see after an overnight run. */}
          {run.notes.map((n) => (
            <p key={n} className="truncate text-xs text-destructive" title={n}>
              {n}
            </p>
          ))}
        </>
      ) : null}
    </div>
  );
}
