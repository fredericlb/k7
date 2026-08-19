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
import type { PlaylistItem } from "@studio/song/playlist";
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
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mediatek } from "../api";

/**
 * How many search hits are drawn at once.
 *
 * A library of three hundred morceaux in one scrolling box is not a list you read, it is one
 * you give up on — and the field above it is the way through. The count of what is NOT shown
 * is said out loud rather than silently dropped.
 */
const MAX_HITS = 40;

export function PlaylistPane({
  items,
  songs,
  onAdd,
  onFiled,
  addRefusal,
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
}) {
  const rows = useMemo(() => resolveItems(items, songs), [items, songs]);

  /**
   * The transport, and the whole of it: one element, playing one file at a time.
   *
   * st0's playlist pane drove a shared `PlaybackProvider` — a mini player that outlived the
   * screen, with a browser/engine destination behind it. None of that came over, deliberately.
   * That machinery exists because st0 is a LISTENING app whose bottom bar follows you across
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
  // UPLOAD is "this file on my disk, filed and then named here". st0 had only the first, since
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
   * The tags are guessed from the file name and not asked for. st0's own upload has a dialogue
   * with three fields, and it is right to: that screen is where a library is CURATED. Here the
   * question being answered is "put this in my set", and stopping to fill a form in the middle
   * of it is the interruption. A wrong guess is fixed in st0, on the song itself.
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
        <span className="text-xs text-muted-foreground">
          {rows.length} ligne{rows.length > 1 ? "s" : ""}
          {playable === rows.length ? "" : ` · ${playable} jouable(s)`}
        </span>
      </header>

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
