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

/**
 * How many search hits are drawn at once.
 *
 * A library of three hundred morceaux in one scrolling box is not a list you read, it is one
 * you give up on — and the field above it is the way through. The count of what is NOT shown
 * is said out loud rather than silently dropped.
 */
const MAX_HITS = 40;

/** How often a running separation is asked how it is getting on. It reports per WINDOW — a few
 *  seconds apart on a CPU — so anything faster asks the same number twice. */
const PREP_POLL_MS = 2000;

/**
 * Separating the whole set list, as it is going.
 *
 * One object rather than five pieces of state, because every tick moves several of them at once
 * and a half-updated bar is a bar that lies about where it is.
 */
interface Run {
  /** Lines with audio to separate, and how many are behind us. */
  total: number;
  done: number;
  /** What is being worked on now, and how far its job says it is. */
  label: string;
  percent: number | null;
  /** Already prepared, so nothing was spent on them. Counted apart from `done` because that
   *  distinction is the whole of what makes re-running this cheap. */
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
  /**
   * Put a line at the end of the playlist.
   *
   * The pane does not own the text — the editor does, and the YamlPane on the left is showing
   * it — so adding a song is a request upwards rather than a write. That is what keeps the two
   * halves one document: the line appears in the text, and this list redraws because the text
   * changed, not because something told it to.
   */
  onAdd: (item: PlaylistItem) => void;
  /** A song has just landed in the médiathèque: re-read the catalogue, so the line this pane
   *  wrote resolves to something rather than sitting on "morceau introuvable" until a poll. */
  onFiled: () => void;
  /** Why `onAdd` would not work right now — the file's `items:` is in a shape the text-level
   *  append cannot extend. Empty when it can. */
  addRefusal?: string;
  /** Dispatch a command line — the stem bar sends you to the settings with one. Absent drops
   *  the button and keeps the sentence, which is still the thing to act on. */
  onRun?: (line: string) => Promise<void>;
}) {
  const rows = useMemo(() => resolveItems(items, songs), [items, songs]);

  /**
   * The transport, and the whole of it: one element, playing one file at a time.
   *
   * pl8's playlist pane drove a shared `PlaybackProvider` — a mini player that outlived the
   * screen, with a browser/engine destination behind it. None of that came over, deliberately.
   * That machinery exists because pl8 is a LISTENING app whose bottom bar follows you across
   * every section; this shell is an editor with a transport of its own already, driving the
   * engine over a project, and a second thing claiming the word "playing" would be two
   * transports on one screen. What a set list needs while you build it is to hear the line you
   * just added, which is an `<audio>` and a same-origin URL.
   */
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

  /**
   * Start the first line from `from` that has audio, or stop if none has.
   *
   * Skipping is deliberate and only ever over a RESOLUTION problem — a song the médiathèque
   * has not got, a variant nobody filed. A playlist that halted on its third line because of a
   * typo would be a playlist you cannot listen to while you fix it. The row still says what is
   * wrong with it; it just does not stop the evening.
   */
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
  //
  // Two buttons, because they are two acts: SEARCH is "one of the morceaux I already have",
  // UPLOAD is "this file on my disk, filed and then named here". pl8 had only the first, since
  // its own Morceaux tab was one click away; from here the médiathèque is another app, and a
  // set list you cannot finish without leaving is a set list you leave.
  //
  // The search stays OPEN after a click. Building a set list is adding eight morceaux in a row,
  // and a panel that shut each time would make that eight round trips through one button. What
  // confirms the add is the list below growing — the text on the left really did change, so
  // there is nothing else to say.
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

  /**
   * A file from the disk: into the médiathèque first, then onto the end of this playlist.
   *
   * That ORDER is the whole feature, and it is why this is one button rather than two steps.
   * The line is written from the path the médiathèque ANSWERS with — never from the tags sent
   * up — because the folder is derived over there (`songFolder`) and a second derivation here
   * would be a second spelling of one song, wrong the first time a tag carries an accent.
   *
   * The tags are guessed from the file name and not asked for. pl8's own upload has a dialogue
   * with three fields, and it is right to: that screen is where a library is CURATED. Here the
   * question being answered is "put this in my set", and stopping to fill a form in the middle
   * of it is the interruption. A wrong guess is fixed in pl8, on the song itself.
   */
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
        // The catalogue moved under us and this pane is what noticed: ask for it again, or the
        // line just written stays "morceau introuvable" until the next poll comes round.
        onFiled();
      } catch (e) {
        // Including the 409: the song is already filed, so the useful half still works —
        // except that we do not know WHERE without the answer, and guessing the folder here is
        // exactly the second spelling the comment above refuses.
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
  //
  // The same work as `playlist stems <playlist> <chaîne>`, driven from here so it can be
  // WATCHED. That verb reports its lines when it is done, which for thirty songs is an hour of
  // nothing on screen; this is one `POST /stems` per line with the job polled between, so the
  // bar says which song and how far into it.
  //
  // SEQUENTIAL, and that is not a simplification: two separations at once on one machine are two
  // hours of arithmetic competing for the same cores and finishing no sooner — the rule
  // `runColdPasses` already states for the command.
  const [separating, setSeparating] = useState(false);
  /**
   * The chain THIS MACHINE separates with, or null when it has never been told.
   *
   * Read and never asked for: which module separates and which model it wants is one answer for
   * the machine, set once with `system stems` and kept in `~/.studio/preferences.yaml`. This
   * screen used to put a picker here, which asked the same question of the same person every time
   * they prepared a set list. `undefined` is "not read yet", which is a third state and reads
   * differently on the button.
   */
  const [chain, setChain] = useState<string | null | undefined>(undefined);
  const [run, setRun] = useState<Run | null>(null);
  /** Read by the loop between two songs and between two polls — the Stop button sets it. A ref
   *  and not state: the loop is closed over the render it started in and would never see one. */
  const stopRef = useRef(false);
  // The loop outlives this component being closed (the panel is a toggle), so leaving is the
  // same event as pressing Stop. What it does not outlive is worth being explicit about: nothing
  // here cancels the SEPARATION, which is a job on the machine and goes on to the end.
  useEffect(
    () => () => {
      stopRef.current = true;
    },
    [],
  );

  // Asked for when the bar opens rather than on mount: this is the one call on this screen that
  // is of no use to somebody who never presses the button. Re-asked on every opening, because the
  // settings panel is one click away and a stale "separates nothing" would send you back to it.
  useEffect(() => {
    if (!separating) return;
    api
      .preferences()
      .then((p) => setChain(p.stemsChain))
      // A file service that will not answer is not a machine with no chain, but the button can do
      // nothing either way — and the run itself says which it was, in the server's own words.
      .catch(() => setChain(null));
  }, [separating]);

  /**
   * Separate every line that has audio, one after another.
   *
   * Two kinds of failure, told apart by the status and treated differently on purpose:
   *
   * - **the song** (404 — this machine has not pulled it) is a note and the loop goes on. One
   *   song missing must not cost the other eleven their preparation.
   * - **the run** (400 or 409 — the chain does not separate, no model, no project open) stops
   *   everything at once. It is the same answer for every line, so carrying on would be twelve
   *   identical refusals and no work done.
   */
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
            // The registry sweeps a finished job after five minutes, so a poll that 404s is
            // usually a run that landed. The question underneath — are the stems on disk — is
            // the other route's, so one trip back through it answers it properly.
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
      {/* Off screen and never controlled by React: `src` and `play()` are imperative, and a
          `<audio>` re-rendered with a new src prop restarts what is playing. */}
      <audio
        ref={audioRef}
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        // The next line begins where this one ended. Only ours can end — this element is this
        // pane's and nothing else writes to it.
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
        {/* « Ajouter » is the file on your disk; « Chercher » is the catalogue. Two verbs, so
            neither hides behind the other's menu. */}
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
            // Cleared so the SAME file picked twice fires again — a replaced upload is a real
            // thing to want, and an unchanged value raises no event.
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
        {/* The night-before job. Here rather than on the desk because it is about the SET LIST
            and not about a record: the desk catches up on the one song you just put on, this
            prepares the twelve you are going to. */}
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

      {/* The separation bar. Above the list like the search, and for the same reason: what it is
          working through stays visible under it. */}
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

      {/* The search. Above the list and not over it: what you are adding to stays visible, so
          you can see the set list grow as you pick — which is the only confirmation there is. */}
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
                // Escape closes without adding; Enter takes the first hit, which is what
                // "type three letters and press return" expects to do.
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
                  {/* The whole row adds the MASTER, which is what a click on a morceau
                      means; the chips beside it name a version instead. */}
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
                  {/* A song's other versions, addable in one click each. Without these,
                      putting `instrumental` in a set list would mean going and typing the
                      mapping by hand — and the playlist format exists to carry exactly that. */}
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
            {/* Never a silent cap: a set list built from a search that quietly hid the
                morceau you wanted is worse than one that says to type another word. */}
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
            {/* The empty state is where the buttons are most needed and least findable up in
                the header, so they are offered again here rather than only pointed at. */}
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
              // Resolved to a version whose file the folder has not got — a different sentence
              // from a variant that does not exist at all.
              const missing = !problem && r.take?.kind === "missing";
              const playingHere = current === i && playing;
              const loadedHere = current === i;
              return (
                <li
                  // The index IS the identity: a playlist may legitimately name the same song
                  // twice, and keying on the ref would make those one row.
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
                  {/* What the line names, when it is not what the row is showing — so a ref
                      that resolved by NAME still says which path it landed on. */}
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

/**
 * Preparing the whole set list: which chain, and how far it has got.
 *
 * A bar rather than a dialogue, for the reason the search above it is one too — what it is
 * working through has to stay visible under it, and this runs for an hour. Its own component
 * because the arithmetic of a two-level progress (song i of n, and how far into song i) is worth
 * reading in one place rather than inlined among the set list's own rows.
 */
function StemsBar({
  chain,
  playable,
  run,
  onStart,
  onStop,
  onSettings,
  onClose,
}: {
  /** The chain this MACHINE separates with: a ref, `null` for "never told", `undefined` while
   *  the preference is being read. Shown and never chosen — see the state it comes from. */
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
  /**
   * The bar's fill, 0..1 — songs finished PLUS how far into the one in hand.
   *
   * Both halves matter and neither alone is honest: a bar that only counted songs would sit
   * still for the four minutes of each one, and a bar that only showed the current job's percent
   * would go back to zero twelve times.
   */
  const at = run
    ? Math.min(1, (run.done + (run.percent ?? 0) / 100) / (run.total || 1))
    : 0;

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2">
        <Split className="h-4 w-4 shrink-0 text-muted-foreground" />
        {/* WHICH chain separates is not asked here, and that is the point: it is one answer for
            the machine, set once (`system stems`) and shown so you can see which one is about to
            run. A picker here asked the same question of the same person at every set list. */}
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

      {/* Told nothing yet: the one sentence that unblocks it, and the way there. Not a picker —
          the machine is asked this once, not once per set list. */}
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

      {/* Before anything has been asked for: what this costs, said up front. A person who
          presses Lancer on twelve songs without knowing that should not have to find out by
          watching. */}
      {run || chain === null ? null : (
        <p className="text-xs text-muted-foreground">
          Chaque morceau prend plusieurs minutes, un à la fois. Ceux qui sont
          déjà séparés sont sautés, et une séparation interrompue reprend là où
          elle en était — relancer ne coûte rien.
        </p>
      )}

      {run ? (
        <>
          {/* A div with the role rather than a <progress>: the native element cannot be drawn
              as the flat rule this shell uses everywhere else, and the role plus its three
              values is exactly what a screen reader wants from either. */}
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
          {/* Never swallowed: a song the machine has not pulled, or one the model choked on,
              is exactly what somebody needs to see after leaving this running overnight. */}
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
