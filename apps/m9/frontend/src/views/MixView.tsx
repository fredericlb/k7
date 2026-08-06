// MixView.tsx — where a set is played: the OPEN PROJECT's songs down one side, one deck on the
// other, its signal path between them. The set list is songs.yaml; what plays them is still
// the deck, because the project's own crossfade is compiled node-side — see
// ../../docs/views.md. The shell owns the chrome around it; this draws the middle.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import type { RankedEngine } from "@studio/engine-browser/probe";
import { readPluginBlock } from "@studio/engine-protocol/build";
import type { MediatekEntry } from "@studio/mediatek/types";
import type { PublicEngine } from "@studio/web-protocol";
import { CloudDownload, Disc3, Headphones, Play, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, currentUser } from "../api";
import { ChainsPanel } from "../chains";
import { deckDoc, loadAndPlay } from "../deck";
import { categoryOf, type DeckModule } from "../graph";
import { type FileLink, fileLink, playablePath, service } from "../service";
import { EMPTY_SET, resolveSet, type SetEntry, type SetList } from "../setList";
import { useEngine } from "../useEngine";

/** The set list's file, project-relative. Named once — the name is @studio/song's. */
const SONGS_FILE = "songs.yaml";

/**
 * Read the project's set list and resolve it against what the cache holds.
 *
 * A project with no `songs.yaml` reads as ABSENT rather than as an error: an l8 song can be
 * opened here, and a set written before the file existed still opens. The route answers 404
 * for both a missing file and an unreadable one, which is why this cannot tell them apart —
 * and does not need to, since neither is something m9 can fix.
 */
async function readSet(
  project: string,
  cached: MediatekEntry[],
): Promise<SetList> {
  const path = project === "." ? SONGS_FILE : `${project}/${SONGS_FILE}`;
  try {
    return resolveSet((await api.read(path)).content, cached);
  } catch {
    return EMPTY_SET;
  }
}

/** One song of the set: what it is called, and whether this machine can play it yet. */
function SetRow({
  song,
  loaded,
  ready,
  onPlay,
}: {
  song: SetEntry;
  loaded: boolean;
  ready: boolean;
  onPlay: () => void;
}) {
  const master = song.entry?.meta?.master;
  // Three states, and they are three different sentences. Not in the cache is the ordinary
  // one — the sync pulls what the open set names, so a song added a minute ago is on its way.
  const why = !song.entry
    ? "pas encore dans le cache de cette machine — la synchro va le chercher"
    : !master
      ? "ce dossier ne porte aucun audio"
      : !ready
        ? "aucun moteur sur cette machine"
        : "jouer";

  return (
    <li
      className={`flex items-baseline gap-3 rounded-md px-3 py-2 ${
        loaded ? "bg-accent/60" : "hover:bg-accent/30"
      }`}
    >
      {song.entry ? (
        <Disc3 className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : (
        <CloudDownload className="h-4 w-4 shrink-0 text-muted-foreground opacity-60" />
      )}
      <span
        className={`min-w-0 flex-1 truncate ${song.entry ? "" : "text-muted-foreground"}`}
      >
        {song.name}
      </span>
      {song.entry?.meta?.artist ? (
        <span className="truncate text-xs text-muted-foreground">
          {String(song.entry.meta.artist)}
        </span>
      ) : null}
      <Button
        size="sm"
        variant="secondary"
        disabled={!ready || !master}
        // Disabled with a reason, not just greyed.
        title={why}
        onClick={onPlay}
      >
        <Play className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}

export function MixView({
  engine,
  project,
}: {
  engine: RankedEngine<PublicEngine>;
  /** The project this app was opened on, workspace-relative — what the set list belongs to. */
  project: string;
}) {
  const deck = useEngine(engine);
  // Derived, never typed and never stored: the file service is on the chosen engine's host.
  // The identity rides in the shared headers — see service.ts. Both used to be text boxes.
  const link = useMemo(() => fileLink(engine), [engine]);
  const [root, setRoot] = useState<string | null>(null);
  const [set, setSet] = useState<SetList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<MediatekEntry | null>(null);
  const [available, setAvailable] = useState<MediatekEntry[]>([]);
  const [modules, setModules] = useState<DeckModule[]>([]);

  const refresh = useCallback(
    async (s: FileLink) => {
      try {
        const sum = await service.summary(s);
        setRoot(sum.root);
        const cached = (await service.songs(s)).entries;
        // TWO sources, and the project's is the one that decides what is drawn: songs.yaml
        // says which songs this set is, the cache listing says which of them this machine can
        // play. A song in the set and not in the cache is a line, not an omission.
        setSet(await readSet(project, cached));
        // The médiathèque's modules are the deck's vocabulary — the same catalogue, the same
        // cache. Allowed to fail on its own: a deck with no effects still plays.
        try {
          setAvailable((await service.modules(s)).entries);
        } catch {
          setAvailable([]);
        }
        setError(null);
      } catch (e) {
        setSet(null);
        setError((e as Error).message);
      }
    },
    [project],
  );

  useEffect(() => {
    // A chosen engine whose host answers on the engine port but not the file port: the
    // catalogue is unreachable, and saying so beats an empty list that looks like an empty
    // médiathèque.
    if (!link)
      return setError(
        "le service de fichiers de cette machine ne répond pas — la médiathèque est injoignable",
      );
    void refresh(link);
  }, [link, refresh]);

  const start = (e: MediatekEntry) => {
    if (!deck.engine || !root) return;
    const abs = playablePath(root, e);
    // Said out loud rather than swallowed: a catalogued folder with no audio is a real
    // state — a mirror that failed halfway — and a dead Play button explains nothing.
    if (!abs)
      return setError(
        `${e.name} : le dossier est catalogué mais ne porte aucun audio`,
      );
    setError(null);
    setLoaded(e);
    loadAndPlay(deck.engine, abs, e.name, modules);
  };

  /** Re-send the document without touching the transport. The engine DIFFS, so a chain
   *  change rebuilds only what moved — the song keeps playing under it. */
  const reapply = useCallback(
    (next: DeckModule[]) => {
      setModules(next);
      if (!deck.engine || !root || !loaded) return;
      const abs = playablePath(root, loaded);
      if (abs) deck.engine.sendProject(deckDoc(abs, loaded.name, next));
    },
    [deck.engine, root, loaded],
  );

  /** Put a médiathèque module on the deck. Its `plugin:` block is read from the CACHE —
   *  the catalogue says where a module is, never what it runs. */
  const addModule = async (e: MediatekEntry) => {
    try {
      if (!link) return;
      const yaml = await service.moduleFile(link, `/module.yaml`);
      reapply([
        ...modules,
        {
          name: e.name,
          category: categoryOf(e.path),
          plugin: readPluginBlock(yaml),
          enabled: true,
        },
      ]);
    } catch (err) {
      setError(`${e.name} : ${(err as Error).message}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1">
      <main className="min-w-0 flex-1 overflow-auto p-6">
        {error ? (
          <Card className="mb-4 p-4 text-sm text-destructive">{error}</Card>
        ) : null}
        {/* A set list that will not parse is the project's problem, not the machine's, so it
            is reported apart from the error above and names its own lines. */}
        {set?.issues.length ? (
          <Card className="mb-4 p-4 text-sm text-destructive">
            <div className="font-semibold">{SONGS_FILE}</div>
            {set.issues.map((i) => (
              <div key={i} className="font-mono text-xs">
                {i}
              </div>
            ))}
          </Card>
        ) : null}
        {set === null ? (
          <Card className="p-6 text-sm text-muted-foreground">
            Pas de service local joignable. m9 lit le CACHE de la médiathèque,
            pas la bibliothèque hébergée — c'est le moteur qui joue, et il ouvre
            des fichiers.
          </Card>
        ) : set.absent ? (
          // No songs.yaml at all — an l8 song opened here, or a set from before the file
          // existed. Named as the missing file it is, since adding it is one edit away in
          // the Édition view.
          <Card className="p-6 text-sm text-muted-foreground">
            Ce projet n'a pas de <code>{SONGS_FILE}</code>. C'est le fichier qui
            dit quels morceaux de la médiathèque font partie du set.
          </Card>
        ) : set.entries.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">
            Le set est vide. Ajoutez des morceaux dans <code>{SONGS_FILE}</code>{" "}
            — ils seront tirés dans le cache de cette machine tout seuls.
          </Card>
        ) : (
          <ul className="flex flex-col gap-1">
            {set.entries.map((s) => (
              <SetRow
                key={s.ref}
                song={s}
                loaded={loaded?.id === s.entry?.id}
                ready={deck.phase.k === "ready"}
                onPlay={() => s.entry && start(s.entry)}
              />
            ))}
          </ul>
        )}
      </main>

      {/* The signal path. Not decorative: the modules it draws are the same list, in the
            same order, that goes into the ProjectDoc — see deckDoc. */}
      <section className="flex min-h-0 w-[28rem] shrink-0 flex-col border-l">
        <div className="flex shrink-0 items-baseline gap-2 border-b px-3 py-2">
          <span className="text-sm font-semibold">Chaîne</span>
          <span className="text-xs text-muted-foreground">
            {modules.length} module(s)
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <ChainsPanel
            song={loaded?.name ?? null}
            modules={modules}
            onBypass={(name) =>
              reapply(
                modules.map((m) =>
                  m.name === name ? { ...m, enabled: !m.enabled } : m,
                ),
              )
            }
          />
        </div>
        {available.length ? (
          <div className="shrink-0 border-t p-2">
            <select
              className="w-full rounded-md border bg-background px-2 py-1 text-xs"
              value=""
              onChange={(ev) => {
                const hit = available.find((m) => m.id === ev.target.value);
                if (hit) void addModule(hit);
              }}
            >
              <option value="">ajouter un module…</option>
              {available.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </section>

      <aside className="flex w-80 shrink-0 flex-col gap-4 border-l p-4">
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold">Platine</div>
          <div className="mb-3 truncate text-sm text-muted-foreground">
            {loaded ? loaded.name : "rien de chargé"}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={deck.playing ? "default" : "secondary"}
              disabled={!deck.engine || !loaded}
              onClick={() =>
                deck.engine?.transport(deck.playing ? "stop" : "play")
              }
            >
              {deck.playing ? (
                <Square className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
            <span className="text-xs text-muted-foreground">
              {deck.playing ? "en lecture" : "arrêté"}
            </span>
          </div>
        </Card>

        <Card className="p-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={deck.listening}
              onChange={(ev) => deck.setListening(ev.target.checked)}
            />
            <Headphones className="h-4 w-4 text-muted-foreground" />
            Écouter ici
          </label>
          {/* Off by default: the sound already comes out of the machine's interface, so
                this doubles it. It is here because it is what étape 7 was for — and because
                on a laptop with no monitors it is the only way to hear anything. */}
          <p className="mt-2 text-xs text-muted-foreground">
            Le son sort déjà de l'interface de cette machine. Cochez pour
            l'entendre aussi dans cet onglet.
          </p>
          {deck.listening ? (
            <p className="mt-2 font-mono text-xs tabular-nums text-muted-foreground">
              tampon {deck.listenStats.depth} · manques{" "}
              {deck.listenStats.underruns}
            </p>
          ) : null}
        </Card>

        {/* Facts now, not fields. Both boxes that used to be here — the service address
              and the DJ's own identity — are derived: the file service sits on the chosen
              engine's host, and the identity is the session's. */}
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold">Machine</div>
          <p className="break-all text-xs text-muted-foreground">
            {engine.engine.hostname}
            <span className="ml-1 opacity-60">({currentUser() || "—"})</span>
          </p>
          {link ? (
            <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
              {link.base}
            </p>
          ) : null}
          {root ? (
            <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">
              {root}
            </p>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="mt-2 w-full text-xs"
            onClick={() => link && void refresh(link)}
          >
            Relire le cache
          </Button>
        </Card>
      </aside>
    </div>
  );
}
