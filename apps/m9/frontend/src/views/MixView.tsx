// MixView.tsx — the desk: a deck top left, a deck top right, the set list between them, and
// the crossfader across the bottom. What plays comes from the project's `songs.yaml`; how loud
// each deck is comes from the crossfader. See ../../docs/mix.md.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import type { RankedEngine } from "@studio/engine-browser/probe";
import type { MediatekEntry } from "@studio/mediatek/types";
import type { PublicEngine } from "@studio/web-protocol";
import {
  CloudDownload,
  Disc3,
  Headphones,
  Play,
  RefreshCw,
  Square,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  type DeckId,
  type DeckLoads,
  MIX_CENTRE,
  NO_LOADS,
  pushCrossfade,
  sendDecks,
} from "../deck";
import {
  cacheRelPath,
  type FileLink,
  fileLink,
  playablePath,
  service,
} from "../service";
import { EMPTY_SET, resolveSet, type SetEntry, type SetList } from "../setList";
import { type Playhead, useEngine } from "../useEngine";
import type { Envelope } from "../waveform";
import { Vinyl } from "./Vinyl";
import { Waveform } from "./Waveform";

/** The set list's file, project-relative. Named once — the name is @studio/song's. */
const SONGS_FILE = "songs.yaml";

/** A deck's waveform, and the two states that are not one. */
type Wave = { k: "loading" } | { k: "ready"; env: Envelope } | { k: "none" };

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
  const [loads, setLoads] = useState<DeckLoads>(NO_LOADS);
  const [mix, setMix] = useState(MIX_CENTRE);
  // Per deck. Three states rather than a nullable envelope: "still computing" and "there
  // will not be one" look identical as `null`, and they are different sentences on screen.
  const [waves, setWaves] = useState<Partial<Record<DeckId, Wave>>>({});

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

  /** Put a song on a deck. The document carries both decks, so this re-sends it — the engine
   *  diffs, and whatever the OTHER deck was playing carries on underneath. */
  const load = (deckId: DeckId, s: SetEntry) => {
    // `link` is implied by `root` — the root came from a summary through it — but it is
    // carried explicitly so the waveform fetch below has it without a second assumption.
    if (!deck.engine || !root || !link || !s.entry) return;
    const path = playablePath(root, s.entry);
    // Said out loud rather than swallowed: a catalogued folder with no audio is a real state
    // — a mirror that failed halfway — and a dead button explains nothing.
    if (!path)
      return setError(
        `${s.name} : le dossier est catalogué mais ne porte aucun audio`,
      );
    setError(null);
    const next: DeckLoads = {
      ...loads,
      [deckId]: { path, title: s.name, artist: s.artist, id: s.id },
    };
    setLoads(next);
    sendDecks(deck.engine, next, mix);

    // The waveform, fetched beside the load and never blocking it: the song is already
    // playing while this is still computing, which is the right order for a deck.
    setWaves((w) => ({ ...w, [deckId]: { k: "loading" } }));
    void service
      // The SAME master `playablePath` just resolved, cache-relative — the route wants a path
      // inside the cache, not one on the engine's disk.
      .envelope(link, cacheRelPath(s.entry) ?? "")
      .then((env) => setWaves((w) => ({ ...w, [deckId]: { k: "ready", env } })))
      // A waveform that will not come is not worth an error card over the whole desk — the
      // song plays regardless, and the strip says it has none rather than lying about it.
      .catch(() => setWaves((w) => ({ ...w, [deckId]: { k: "none" } })));
  };

  /** Drag the crossfader. One message per move, not a document — see pushCrossfade. */
  const crossfade = (value: number) => {
    setMix(value);
    if (deck.engine) pushCrossfade(deck.engine, value);
  };

  const anyLoaded = !!(loads.deckA || loads.deckB);
  const ready = deck.phase.k === "ready";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* --- the two decks, and the set list between them ------------------------------ */}
      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <DeckSide
          side="A"
          load={loads.deckA}
          spinning={deck.playing}
          wave={waves.deckA}
          playhead={deck.playhead}
          playing={deck.playing}
        />

        <section className="flex min-w-0 flex-1 flex-col gap-2">
          {error ? (
            <Card className="p-3 text-sm text-destructive">{error}</Card>
          ) : null}
          {/* A set list that will not parse is the project's problem, not the machine's, so
              it is reported apart from the error above and names its own lines. */}
          {set?.issues.length ? (
            <Card className="p-3 text-sm text-destructive">
              <div className="font-semibold">{SONGS_FILE}</div>
              {set.issues.map((i) => (
                <div key={i} className="font-mono text-xs">
                  {i}
                </div>
              ))}
            </Card>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto">
            <SetListPane set={set} ready={ready} loads={loads} onLoad={load} />
          </div>
        </section>

        <DeckSide
          side="B"
          load={loads.deckB}
          spinning={deck.playing}
          wave={waves.deckB}
          playhead={deck.playhead}
          playing={deck.playing}
        />
      </div>

      {/* --- the crossfader, across the bottom ----------------------------------------- */}
      <footer className="flex h-[10%] min-h-[4.5rem] shrink-0 items-center gap-6 border-t px-6">
        {/* Off by default: the sound already comes out of the machine's interface, so this
            doubles it. On a laptop with no monitors it is the only way to hear anything. */}
        <label
          className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"
          title="Le son sort déjà de l'interface de cette machine. Cochez pour l'entendre aussi dans cet onglet."
        >
          <input
            type="checkbox"
            checked={deck.listening}
            onChange={(e) => deck.setListening(e.target.checked)}
          />
          <Headphones className="h-4 w-4" />
          Écouter ici
        </label>

        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="w-4 shrink-0 text-center text-sm font-semibold">
            A
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={mix}
            onChange={(e) => crossfade(Number(e.target.value))}
            disabled={!ready}
            className="min-w-0 flex-1 accent-foreground"
            aria-label="crossfade entre la platine A et la platine B"
          />
          <span className="w-4 shrink-0 text-center text-sm font-semibold">
            B
          </span>
          {/* Double-click the readout to recentre — the one crossfader position worth a
              shortcut, and the one a mouse drag never lands on exactly. */}
          <button
            type="button"
            onDoubleClick={() => crossfade(MIX_CENTRE)}
            title="double-clic : recentrer"
            className="w-12 shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
          >
            {Math.round(mix * 100)}%
          </button>
        </div>

        <Button
          size="sm"
          variant={deck.playing ? "default" : "secondary"}
          disabled={!ready || !anyLoaded}
          // ONE transport for both decks: the engine has a single one, so this runs the whole
          // document and the crossfader is what chooses between them. See docs/mix.md.
          title={
            !ready
              ? "aucun moteur sur cette machine"
              : !anyLoaded
                ? "aucune platine chargée"
                : deck.playing
                  ? "arrêter"
                  : "lancer les deux platines"
          }
          onClick={() => deck.engine?.transport(deck.playing ? "stop" : "play")}
        >
          {deck.playing ? (
            <Square className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>

        <Button
          size="sm"
          variant="ghost"
          className="shrink-0 text-xs"
          title="Relire le cache de la médiathèque"
          onClick={() => link && void refresh(link)}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </footer>
    </div>
  );
}

/** One deck: the record, its waveform, and what it is holding. */
function DeckSide({
  side,
  load,
  spinning,
  wave,
  playhead,
  playing,
}: {
  side: string;
  load: DeckLoads[DeckId];
  spinning: boolean;
  wave: Wave | undefined;
  playhead: React.RefObject<Playhead>;
  playing: boolean;
}) {
  return (
    <section className="flex w-[26%] min-w-[14rem] shrink-0 flex-col items-center gap-3">
      <Vinyl
        side={side}
        artist={load?.artist ?? null}
        title={load?.title ?? null}
        spinning={spinning && !!load}
      />
      {/* Under the record, as a deck has it. Only once something is loaded: an empty strip
          under an empty deck is furniture. */}
      {load ? (
        <Waveform
          envelope={wave?.k === "ready" ? wave.env : null}
          playhead={playhead}
          playing={playing}
          analysing={wave?.k === "loading"}
        />
      ) : null}
      <div className="w-full truncate text-center text-xs text-muted-foreground">
        {load ? load.title : "rien de chargé"}
      </div>
    </section>
  );
}

/** The project's songs, with a button per deck on each row. */
function SetListPane({
  set,
  ready,
  loads,
  onLoad,
}: {
  set: SetList | null;
  ready: boolean;
  loads: DeckLoads;
  onLoad: (deck: DeckId, s: SetEntry) => void;
}) {
  if (set === null)
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Pas de service local joignable. m9 lit le CACHE de la médiathèque, pas
        la bibliothèque hébergée — c'est le moteur qui joue, et il ouvre des
        fichiers.
      </Card>
    );
  // No songs.yaml at all — an l8 song opened here, or a set from before the file existed.
  // Named as the missing file it is, since adding it is one edit away in the Édition view.
  if (set.absent)
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Ce projet n'a pas de <code>{SONGS_FILE}</code>. C'est le fichier qui dit
        quels morceaux de la médiathèque font partie du set.
      </Card>
    );
  if (!set.entries.length)
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Le set est vide. Ajoutez des morceaux dans <code>{SONGS_FILE}</code> —
        ils seront tirés dans le cache de cette machine tout seuls.
      </Card>
    );

  return (
    <ul className="flex flex-col gap-1">
      {set.entries.map((s) => (
        <SetRow
          key={s.ref}
          song={s}
          ready={ready}
          on={
            loads.deckA?.id === s.id
              ? "A"
              : loads.deckB?.id === s.id
                ? "B"
                : null
          }
          onLoad={onLoad}
        />
      ))}
    </ul>
  );
}

/** One song of the set: what it is called, whether this machine can play it, and the two
 *  buttons that put it on a deck. */
function SetRow({
  song,
  ready,
  on,
  onLoad,
}: {
  song: SetEntry;
  ready: boolean;
  /** The deck this song is currently on, or null. */
  on: string | null;
  onLoad: (deck: DeckId, s: SetEntry) => void;
}) {
  const master = song.entry?.meta?.master;
  const playable = !!song.entry && !!master && ready;
  // Three states, and they are three different sentences. Not in the cache is the ordinary
  // one — the sync pulls what the open set names, so a song added a minute ago is on its way.
  const why = !song.entry
    ? "pas encore dans le cache de cette machine — la synchro va le chercher"
    : !master
      ? "ce dossier ne porte aucun audio"
      : !ready
        ? "aucun moteur sur cette machine"
        : null;

  return (
    <li
      className={`flex items-center gap-3 rounded-md px-3 py-2 ${
        on ? "bg-accent/60" : "hover:bg-accent/30"
      }`}
    >
      {song.entry ? (
        <Disc3 className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : (
        <CloudDownload className="h-4 w-4 shrink-0 text-muted-foreground opacity-60" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={`truncate text-sm ${song.entry ? "" : "text-muted-foreground"}`}
        >
          {song.name}
        </span>
        {song.artist ? (
          <span className="truncate text-xs text-muted-foreground">
            {song.artist}
          </span>
        ) : null}
      </span>
      {(["A", "B"] as const).map((s) => (
        <Button
          key={s}
          size="sm"
          variant={on === s ? "default" : "secondary"}
          disabled={!playable}
          // Disabled with a reason, not just greyed.
          title={why ?? `charger sur la platine ${s}`}
          onClick={() => onLoad(s === "A" ? "deckA" : "deckB", song)}
        >
          {s}
        </Button>
      ))}
    </li>
  );
}

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
