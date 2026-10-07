// Session.tsx — the session as it is PLAYED: the order of the rounds, the songs inside the one
// you pick, and the track panel that sets an extract's bounds. The raw YAML is still one click
// away, because this format is young and the file is the truth. See docs/editing.md.

import { Alert, AlertDescription } from "@frediverse/ui/alert";
import { AppHeader } from "@frediverse/ui/app-header";
import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  LogOut,
  Music,
  Pause,
  Plus,
  Trash2,
} from "@frediverse/ui/icons";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Preview } from "./audio";
import { Row, RowAction, Tip } from "./controls";
import {
  addSong,
  addTrack,
  moveSong,
  removeSong,
  removeTrack,
  type Song,
  serialize,
  songsInRange,
} from "./format";
import { label } from "./mediatek";
import { OrderEditor } from "./OrderEditor";
import {
  CategoryFields,
  SaveBadge,
  SessionPanel,
  SongFields,
} from "./SessionFields";
import { SongPicker } from "./SongPicker";
import { Store } from "./store";
import { TrackPanel } from "./TrackPanel";

/** What the left column is pointing at: the header, or one entry of the order. */
type Pick = { k: "session" } | { k: "cat"; slug: string; range?: string };

function songTitle(song: Song, catalogue: Store["catalogue"]) {
  if (song.label) return song.label;
  const first = song.tracks[0];
  const name = label(first?.song, catalogue);
  if (name) return name;
  return first?.file ?? first?.youtube ?? "Morceau sans adresse";
}

export function Session({
  project,
  quit,
}: {
  project: string;
  quit: () => void;
}) {
  const store = useMemo(() => new Store(), []);
  const preview = useMemo(() => new Preview(), []);
  useSyncExternalStore(store.subscribe, store.getVersion);

  const [pick, setPick] = useState<Pick>({ k: "session" });
  const [songIndex, setSongIndex] = useState(0);
  const [trackIndex, setTrackIndex] = useState(0);
  // From the live Document, unsaved edits and all — see ../../docs/editing.md.
  const [showRaw, setShowRaw] = useState(false);
  // Which picker is open, if any: adding a SONG to the category, or a TRACK to the open song.
  const [adding, setAdding] = useState(false);
  const [addingTrack, setAddingTrack] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void store.load();
    return () => preview.dispose();
  }, [store, preview]);

  // Ctrl+S means "now", not "at all" — the same rule st0's editors follow.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void store.flush();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  const session = store.session;
  const cat = pick.k === "cat" ? store.categories.get(pick.slug) : undefined;
  const songs = cat ? cat.songs : [];
  const song = songs[songIndex];
  const track = song?.tracks[trackIndex];
  // Which songs THIS entry of the order plays — a category can be sliced into several rounds.
  const inRange = useMemo(
    () =>
      cat && pick.k === "cat"
        ? new Set(songsInRange(cat.songs, pick.range))
        : null,
    [cat, pick],
  );

  const rawText = useMemo(() => {
    if (!showRaw) return null;
    const doc =
      pick.k === "cat" ? store.categoryDoc(pick.slug) : store.sessionDoc;
    return doc ? serialize(doc) : null;
    // store.getVersion() is subscribed above, so an edit re-runs this and the text follows.
  }, [showRaw, pick, store, store.getVersion()]);

  const openCat = (slug: string, range?: string) => {
    setPick({ k: "cat", slug, range });
    setSongIndex(0);
    setTrackIndex(0);
  };

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* No user menu: an opened project has no room for a way out of it (packages/ui-user-menu/docs/userMenu.md). */}
      <AppHeader
        title="z0"
        subtitle={session?.name ?? project}
        actions={
          <>
            <SaveBadge store={store} />
            <Tip label="Le fichier tel qu'il sera écrit, modifications non enregistrées comprises">
              <Button
                variant={showRaw ? "default" : "ghost"}
                size="sm"
                aria-pressed={showRaw}
                onClick={() => setShowRaw((v) => !v)}
              >
                <FileText className="size-3.5" /> YAML
              </Button>
            </Tip>
            <Button variant="ghost" size="sm" onClick={quit}>
              <LogOut className="size-3.5" /> Projets
            </Button>
          </>
        }
      />

      {(store.loadError || store.catalogueError) && (
        <div className="flex flex-col gap-2 border-b p-3">
          {store.loadError && (
            <Alert variant="destructive">
              <AlertDescription>{store.loadError}</AlertDescription>
            </Alert>
          )}
          {store.catalogueError && (
            <Alert>
              <AlertDescription>
                Médiathèque injoignable ({store.catalogueError}) — les morceaux
                s'affichent par leur adresse et l'aperçu audio est indisponible.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ── the order: what the evening actually is ─────────────────── */}
        <nav className="w-64 shrink-0 overflow-y-auto border-r py-1">
          <Row
            active={pick.k === "session"}
            onClick={() => setPick({ k: "session" })}
          >
            <FileText className="size-3 shrink-0" /> En-tête de session
          </Row>

          <p className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">
            Les manches
          </p>
          {session?.order.map((e, i) =>
            e.kind === "pause" ? (
              <div
                key={i}
                className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground italic"
              >
                <Pause className="size-3" /> {e.message || "Pause"}
              </div>
            ) : (
              <Row
                key={i}
                active={
                  pick.k === "cat" &&
                  pick.slug === e.cat &&
                  pick.range === e.songs
                }
                onClick={() => e.cat && openCat(e.cat, e.songs)}
              >
                <Music className="size-3 shrink-0" />
                <span className="truncate">
                  {(e.cat && store.categories.get(e.cat)?.name) || e.cat}
                </span>
                {e.songs && <Badge className="ml-auto">{e.songs}</Badge>}
              </Row>
            ),
          )}
          {session && session.order.length === 0 && (
            <p className="px-3 py-1 text-xs text-muted-foreground">
              Aucun ordre dans session.yaml.
            </p>
          )}

          <div className="flex items-center gap-1 px-3 pt-3 pb-1">
            <p className="text-xs font-medium text-muted-foreground">
              Toutes les catégories
            </p>
            <RowAction
              title="Nouvelle catégorie"
              onClick={() => {
                void store.createCategory("Nouvelle catégorie").then((slug) => {
                  setPick({ k: "cat", slug });
                  setSongIndex(0);
                  setTrackIndex(0);
                });
              }}
            >
              <Plus />
            </RowAction>
          </div>
          {[...store.categories.values()].map((c) => (
            <Row
              key={c.slug}
              active={pick.k === "cat" && pick.slug === c.slug && !pick.range}
              onClick={() => openCat(c.slug)}
            >
              <span className="truncate">{c.name ?? c.slug}</span>
              <Badge className="ml-auto">{c.songs.length}</Badge>
            </Row>
          ))}
        </nav>

        {/* ── the songs of the picked round ───────────────────────────── */}
        <nav className="w-72 shrink-0 overflow-y-auto border-r py-1">
          {pick.k === "cat" && cat ? (
            <>
              <div className="flex items-start gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {cat.name ?? cat.slug}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[cat.mode, cat.variant].filter(Boolean).join(" · ") ||
                      "mode normal"}
                  </p>
                </div>
                <Tip label="Ajouter un morceau depuis la médiathèque">
                  <Button
                    size="icon-sm"
                    variant={adding ? "default" : "secondary"}
                    aria-label="Ajouter un morceau depuis la médiathèque"
                    aria-pressed={adding}
                    className="shrink-0"
                    onClick={() => setAdding((v) => !v)}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </Tip>
              </div>
              {adding && (
                <SongPicker
                  catalogue={store.catalogue}
                  onCancel={() => setAdding(false)}
                  onPick={(s) => {
                    store.editCategory(cat.slug, (doc) => addSong(doc, s.id));
                    setAdding(false);
                    setSongIndex(cat.songs.length);
                    setTrackIndex(0);
                  }}
                />
              )}
              {songs.map((s, i) => {
                // Greyed, not hidden: a category is sliced across rounds, and the slice reads better whole.
                const played = !inRange || inRange.has(s);
                const edit = (fn: (d: Parameters<typeof addSong>[0]) => void) =>
                  store.editCategory(cat.slug, fn);
                return (
                  <div
                    key={i}
                    className={`group flex items-center gap-1 pr-1 ${
                      songIndex === i
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50"
                    }`}
                  >
                    <Button
                      variant="ghost"
                      className="h-auto min-w-0 flex-1 justify-start gap-2 px-3 py-1 font-normal hover:bg-transparent"
                      onClick={() => {
                        setSongIndex(i);
                        setTrackIndex(0);
                      }}
                    >
                      <span
                        className={`w-5 shrink-0 text-[10px] ${played ? "text-muted-foreground" : "text-muted-foreground/30"}`}
                      >
                        {i + 1}
                      </span>
                      <span
                        className={`truncate ${played ? "" : "text-muted-foreground/40"}`}
                      >
                        {songTitle(s, store.catalogue)}
                      </span>
                      {s.tracks.length > 1 && (
                        <Badge className="ml-auto">{s.tracks.length}</Badge>
                      )}
                    </Button>
                    <div className="flex shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                      <RowAction
                        title="Monter"
                        disabled={i === 0}
                        onClick={() => {
                          edit((d) => moveSong(d, i, i - 1));
                          setSongIndex(i - 1);
                        }}
                      >
                        <ChevronUp />
                      </RowAction>
                      <RowAction
                        title="Descendre"
                        disabled={i === songs.length - 1}
                        onClick={() => {
                          edit((d) => moveSong(d, i, i + 1));
                          setSongIndex(i + 1);
                        }}
                      >
                        <ChevronDown />
                      </RowAction>
                      <RowAction
                        title="Retirer de cette catégorie"
                        onClick={() => {
                          edit((d) => removeSong(d, i));
                          setSongIndex((n) =>
                            Math.max(0, Math.min(n, songs.length - 2)),
                          );
                          setTrackIndex(0);
                        }}
                      >
                        <Trash2 />
                      </RowAction>
                    </div>
                  </div>
                );
              })}
              {songs.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Cette catégorie n'a aucun morceau.
                </p>
              )}
            </>
          ) : (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Choisissez une manche à gauche.
            </p>
          )}
        </nav>

        {/* ── the panel ───────────────────────────────────────────────── */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          {rawText !== null && (
            <pre className="border-b bg-muted/30 p-4 font-mono text-xs leading-relaxed whitespace-pre">
              {rawText}
            </pre>
          )}
          {pick.k === "session" && session && (
            <>
              <SessionPanel store={store} />
              <OrderEditor store={store} onOpen={openCat} />
            </>
          )}
          {pick.k === "cat" && cat && (
            <CategoryFields
              store={store}
              cat={cat}
              onDeleted={() => setPick({ k: "session" })}
            />
          )}
          {pick.k === "cat" && cat && song && (
            <>
              <SongFields
                store={store}
                cat={cat}
                song={song}
                songIndex={songIndex}
              />
              {/* Always there, since adding a second track is what turns a song into a `fusion`. */}
              <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2">
                {song.tracks.map((t, i) => (
                  <span key={i} className="flex items-center">
                    <Button
                      size="sm"
                      variant={i === trackIndex ? "default" : "secondary"}
                      onClick={() => setTrackIndex(i)}
                    >
                      {label(t.song, store.catalogue) || `Piste ${i + 1}`}
                    </Button>
                    {!song.flat && (
                      <RowAction
                        title="Retirer cette piste"
                        onClick={() => {
                          store.editCategory(cat.slug, (d) =>
                            removeTrack(d, song, songIndex, i),
                          );
                          setTrackIndex(0);
                        }}
                      >
                        <Trash2 />
                      </RowAction>
                    )}
                  </span>
                ))}
                <Tip label="Ajouter une piste à ce morceau">
                  <Button
                    size="icon-sm"
                    variant={addingTrack ? "default" : "secondary"}
                    aria-label="Ajouter une piste à ce morceau"
                    aria-pressed={addingTrack}
                    onClick={() => setAddingTrack((v) => !v)}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </Tip>
              </div>
              {addingTrack && (
                <SongPicker
                  catalogue={store.catalogue}
                  onCancel={() => setAddingTrack(false)}
                  onPick={(s) => {
                    store.editCategory(cat.slug, (d) =>
                      addTrack(d, song, songIndex, s.id),
                    );
                    setAddingTrack(false);
                    setTrackIndex(song.tracks.length);
                  }}
                />
              )}
              {track && (
                <TrackPanel
                  store={store}
                  category={cat}
                  song={song}
                  songIndex={songIndex}
                  track={track}
                  trackIndex={trackIndex}
                  catalogue={store.catalogue}
                  preview={preview}
                />
              )}
            </>
          )}
          {pick.k === "cat" && cat && !song && (
            <p className="p-4 text-sm text-muted-foreground">
              Choisissez un morceau.
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
