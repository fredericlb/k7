// Session.tsx — the session as it is PLAYED: the order of the rounds, the songs inside the one
// you pick, and the track panel that sets an extract's bounds. The raw YAML is still one click
// away, because this format is young and the file is the truth. See docs/editing.md.

import { Button } from "@frediverse/ui/button";
import { Input } from "@frediverse/ui/input";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  LogOut,
  Music,
  Pause,
  Plus,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Preview } from "./audio";
import {
  addSong,
  addTrack,
  type Category,
  EFFECT_KEYS,
  MODES,
  moveSong,
  removeSong,
  removeTrack,
  type Song,
  serialize,
  setCategoryField,
  setSessionField,
  setSongEffect,
  setSongField,
  songsInRange,
} from "./format";
import { label } from "./mediatek";
import { OrderEditor } from "./OrderEditor";
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
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <span className="text-sm font-semibold">
          {session?.name ?? project}
        </span>
        <SaveBadge store={store} />
        <Button
          variant={showRaw ? "default" : "ghost"}
          size="sm"
          className="ml-auto text-xs"
          onClick={() => setShowRaw((v) => !v)}
          title="Le fichier tel qu'il sera écrit, modifications non enregistrées comprises"
        >
          <FileText className="mr-1 h-3 w-3" /> YAML
        </Button>
        <Button variant="ghost" size="sm" className="text-xs" onClick={quit}>
          <LogOut className="mr-1 h-3 w-3" /> Projets
        </Button>
      </header>

      {store.loadError && (
        <p className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {store.loadError}
        </p>
      )}
      {store.catalogueError && (
        <p className="border-b bg-muted px-4 py-1 text-xs text-muted-foreground">
          Médiathèque injoignable ({store.catalogueError}) — les morceaux
          s'affichent par leur adresse et l'aperçu audio est indisponible.
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ── the order: what the evening actually is ─────────────────── */}
        <nav className="w-64 shrink-0 overflow-y-auto border-r py-1">
          <Row
            active={pick.k === "session"}
            onClick={() => setPick({ k: "session" })}
          >
            <FileText className="h-3 w-3 shrink-0" /> En-tête de session
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
                <Pause className="h-3 w-3" /> {e.message || "Pause"}
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
                <Music className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  {(e.cat && store.categories.get(e.cat)?.name) || e.cat}
                </span>
                {e.songs && (
                  <span className="ml-auto shrink-0 rounded bg-muted px-1 text-[10px]">
                    {e.songs}
                  </span>
                )}
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
            <IconButton
              title="Nouvelle catégorie"
              onClick={() => {
                void store.createCategory("Nouvelle catégorie").then((slug) => {
                  setPick({ k: "cat", slug });
                  setSongIndex(0);
                  setTrackIndex(0);
                });
              }}
            >
              <Plus className="h-3 w-3" />
            </IconButton>
          </div>
          {[...store.categories.values()].map((c) => (
            <Row
              key={c.slug}
              active={pick.k === "cat" && pick.slug === c.slug && !pick.range}
              onClick={() => openCat(c.slug)}
            >
              <span className="truncate">{c.name ?? c.slug}</span>
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                {c.songs.length}
              </span>
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
                <Button
                  size="sm"
                  variant={adding ? "default" : "secondary"}
                  className="shrink-0 text-xs"
                  onClick={() => setAdding((v) => !v)}
                  title="Ajouter un morceau depuis la médiathèque"
                >
                  <Plus className="h-3 w-3" />
                </Button>
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
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1 text-left text-sm"
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
                        <span className="ml-auto shrink-0 rounded bg-muted px-1 text-[10px]">
                          {s.tracks.length}
                        </span>
                      )}
                    </button>
                    <div className="flex shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                      <IconButton
                        title="Monter"
                        disabled={i === 0}
                        onClick={() => {
                          edit((d) => moveSong(d, i, i - 1));
                          setSongIndex(i - 1);
                        }}
                      >
                        <ChevronUp className="h-3 w-3" />
                      </IconButton>
                      <IconButton
                        title="Descendre"
                        disabled={i === songs.length - 1}
                        onClick={() => {
                          edit((d) => moveSong(d, i, i + 1));
                          setSongIndex(i + 1);
                        }}
                      >
                        <ChevronDown className="h-3 w-3" />
                      </IconButton>
                      <IconButton
                        title="Retirer de cette catégorie"
                        onClick={() => {
                          edit((d) => removeSong(d, i));
                          setSongIndex((n) =>
                            Math.max(0, Math.min(n, songs.length - 2)),
                          );
                          setTrackIndex(0);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </IconButton>
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
                      className="text-xs"
                      onClick={() => setTrackIndex(i)}
                    >
                      {label(t.song, store.catalogue) || `Piste ${i + 1}`}
                    </Button>
                    {!song.flat && (
                      <IconButton
                        title="Retirer cette piste"
                        onClick={() => {
                          store.editCategory(cat.slug, (d) =>
                            removeTrack(d, song, songIndex, i),
                          );
                          setTrackIndex(0);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </IconButton>
                    )}
                  </span>
                ))}
                <Button
                  size="sm"
                  variant={addingTrack ? "default" : "secondary"}
                  className="text-xs"
                  onClick={() => setAddingTrack((v) => !v)}
                  title="Ajouter une piste à ce morceau"
                >
                  <Plus className="h-3 w-3" />
                </Button>
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

function Row({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1 text-left text-sm ${
        active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
      }`}
    >
      {children}
    </button>
  );
}

/** A row action: small, quiet, and only reachable once the row is hovered or focused. */
function IconButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Field({
  label: text,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{text}</span>
      <Input
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function SessionPanel({ store }: { store: Store }) {
  const s = store.session;
  if (!s) return null;
  const set = (k: string) => (v: string) =>
    store.editSession((doc) => setSessionField(doc, k, v));
  return (
    <div className="grid max-w-xl gap-3 p-4">
      <Field label="Nom" value={s.name} onChange={set("name")} />
      <Field
        label="Jeton d'URL publique"
        value={s.token}
        onChange={set("token")}
      />
      <Field
        label="Mot de passe invité"
        value={s.password}
        onChange={set("password")}
        placeholder="aucun"
      />
      <Field
        label="Consigne par défaut"
        value={s.notice}
        onChange={set("notice")}
      />
      {/* The password rides in the repository in clear, and changing it is a commit (../../docs/projects.md). */}
      <p className="text-xs text-muted-foreground">
        Le mot de passe voyage en clair avec la session : le changer est un
        commit.
      </p>
    </div>
  );
}

function CategoryFields({
  store,
  cat,
  onDeleted,
}: {
  store: Store;
  cat: Category;
  onDeleted: () => void;
}) {
  const set =
    (k: string) =>
    (v: string | boolean): void =>
      store.editCategory(cat.slug, (doc) => setCategoryField(doc, k, v));
  return (
    <div className="border-b p-3">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Nom affiché" value={cat.name} onChange={set("name")} />
        <label className="block">
          <span className="text-xs text-muted-foreground">Mode</span>
          <select
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={cat.mode ?? ""}
            onChange={(e) => set("mode")(e.target.value)}
          >
            <option value="">normal</option>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <Field
          label="Variante jouée"
          value={cat.variant}
          onChange={set("variant")}
          placeholder="le master"
        />
        <Field
          label="Consigne"
          value={cat.notice}
          onChange={set("notice")}
          placeholder="celle de la session"
        />
        <Field
          label="Illustration"
          value={cat.illustration}
          onChange={set("illustration")}
        />
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            checked={cat.liveOnly ?? false}
            onChange={(e) => set("liveOnly")(e.target.checked)}
          />
          <span>Seulement en live</span>
        </label>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          categories/{cat.slug}.yaml
        </span>
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto text-xs"
          title="Le fichier part à la corbeille du service de fichiers ; les manches qui le nomment restent."
          onClick={() => {
            void store.deleteCategory(cat.slug);
            onDeleted();
          }}
        >
          <Trash2 className="mr-1 h-3 w-3" /> Supprimer la catégorie
        </Button>
      </div>
    </div>
  );
}

function SongFields({
  store,
  cat,
  song,
  songIndex,
}: {
  store: Store;
  cat: Category;
  song: Song;
  songIndex: number;
}) {
  const set =
    (k: string) =>
    (v: string | number | boolean | undefined): void =>
      store.editCategory(cat.slug, (doc) => setSongField(doc, songIndex, k, v));
  const effect = (k: string, v: number | undefined) =>
    store.editCategory(cat.slug, (doc) =>
      setSongEffect(doc, song, songIndex, k, v),
    );
  return (
    <div className="border-b p-3">
      <div className="grid gap-3 md:grid-cols-3">
        <Field
          label="Intitulé"
          value={song.label}
          onChange={set("label")}
          placeholder="l'artiste et le titre"
        />
        <label className="block">
          <span className="text-xs text-muted-foreground">État</span>
          <select
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={song.status ?? ""}
            onChange={(e) => set("status")(e.target.value)}
          >
            <option value="">—</option>
            <option value="valid">valid</option>
            <option value="to_replace">to_replace</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">Vitesse</span>
          <Input
            type="number"
            step="0.01"
            value={song.speed ?? ""}
            placeholder="1"
            onChange={(e) =>
              set("speed")(
                e.target.value === "" ? undefined : Number(e.target.value),
              )
            }
          />
        </label>
      </div>

      {/* A textarea and not an input: `answer:` is a literal block, one accepted spelling per line. */}
      <label className="mt-3 block">
        <span className="text-xs text-muted-foreground">
          Réponses acceptées — une par ligne
        </span>
        <textarea
          rows={song.answer?.includes("\n") ? 4 : 2}
          className="w-full rounded-md border bg-background p-2 font-mono text-xs"
          value={song.answer ?? ""}
          placeholder="celle de la catégorie"
          onChange={(e) => set("answer")(e.target.value)}
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={song.liveOnly ?? false}
            onChange={(e) => set("liveOnly")(e.target.checked)}
          />
          <span>Seulement en live</span>
        </label>
        <details className="w-full">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Traitements{" "}
            {song.effects ? `(${Object.keys(song.effects).length})` : ""}
          </summary>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            {EFFECT_KEYS.map((k) => (
              <label key={k} className="block">
                <span className="text-xs text-muted-foreground">{k}</span>
                <Input
                  type="number"
                  step="1"
                  value={song.effects?.[k] ?? ""}
                  placeholder="—"
                  onChange={(e) =>
                    effect(
                      k,
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value),
                    )
                  }
                />
              </label>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}

function SaveBadge({ store }: { store: Store }) {
  const { saveStatus, saveError, hasUnsaved } = store;
  if (saveStatus === "saving")
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Enregistrement…
      </span>
    );
  if (saveStatus === "error")
    return (
      <span className="text-xs text-destructive" title={saveError}>
        Non enregistré : {saveError}
      </span>
    );
  if (hasUnsaved)
    return <span className="text-xs text-muted-foreground">Modifié…</span>;
  if (saveStatus === "saved")
    return <span className="text-xs text-muted-foreground">Enregistré</span>;
  return null;
}
