// MixView.tsx — the desk: two decks facing each other, each with its tempo on the outer edge
// and its channel strip on the inner one, and the crossfader across the bottom. What plays
// comes from the project's `songs.yaml`, chosen at the record itself. See ../../docs/mix.md.
//
// It DRAWS the decks and owns nothing about them. The document — what is loaded, what it plays
// at, every gesture that changes either — is `useDeckSet`, held by Studio, because this view is
// unmounted the moment somebody opens the graph and a set does not stop existing then.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import type { RankedEngine } from "@studio/engine-browser/probe";
import type { MediatekEntry } from "@studio/mediatek/types";
import type { PublicEngine } from "@studio/web-protocol";
import {
  Headphones,
  Link2,
  Play,
  RefreshCw,
  Square,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { beatPhase } from "../beats";
import { type DeckId, type DeckLoads, type DeckTempo, MIX_CENTRE } from "../deck";
import { MIX_VIEW_FILE } from "../mixView";
import {
  cacheRelPath,
  type FileLink,
  fileLink,
  playablePath,
  service,
} from "../service";
import { EMPTY_SET, resolveSet, type SetEntry, type SetList } from "../setList";
import type { DeckSet } from "../useDeckSet";
import { type Playhead, type Deck } from "../useEngine";
import type { Envelope } from "../waveform";
import { BpmFader } from "./BpmFader";
import { ChannelStrip } from "./ChannelStrip";
import { SongBrowser } from "./SongBrowser";
import { Vinyl } from "./Vinyl";
import { Waveform } from "./Waveform";

/** The set list's file, project-relative. Named once — the name is @studio/song's. */
const SONGS_FILE = "songs.yaml";

/**
 * A deck's waveform, and the two states that are not one.
 *
 * `none` CARRIES ITS REASON. It used to be a bare marker, and nothing drew it: a failed
 * envelope and a deck with no waveform looked identical — an empty strip, no explanation,
 * nothing to act on. The reason is the whole value of the state.
 */
type Wave =
  | { k: "loading" }
  | { k: "ready"; env: Envelope }
  | { k: "none"; why: string };

export function MixView({
  engine,
  deck,
  set: decks,
  project,
}: {
  engine: RankedEngine<PublicEngine>;
  /** The engine link, held by Studio so both views share one. */
  deck: Deck;
  /** The decks as a document — everything this view shows and every gesture it forwards. */
  set: DeckSet;
  /** The project this app was opened on, workspace-relative — what the set list belongs to. */
  project: string;
}) {
  // Derived, never typed and never stored: the file service is on the chosen engine's host.
  // The identity rides in the shared headers — see service.ts. Both used to be text boxes.
  const link = useMemo(() => fileLink(engine), [engine]);
  const [root, setRoot] = useState<string | null>(null);
  const [set, setSet] = useState<SetList | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per deck. Three states rather than a nullable envelope: "still computing" and "there
  // will not be one" look identical as `null`, and they are different sentences on screen.
  const [waves, setWaves] = useState<Partial<Record<DeckId, Wave>>>({});
  /** Which deck's song browser is open, if any — one dialog, told which deck it is for. */
  const [browsing, setBrowsing] = useState<DeckId | null>(null);

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

  /**
   * Put a song on a deck.
   *
   * The two halves land apart on purpose: the song goes on and PLAYS at once, and the
   * analysis — the waveform, the tempo, the beat grid — arrives when it arrives. A deck that
   * waited for the second would be a deck that waited.
   */
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
    decks.putOn(deckId, { path, title: s.name, artist: s.artist, id: s.id });

    setWaves((w) => ({ ...w, [deckId]: { k: "loading" } }));
    // A new record starts at ITS own tempo, whatever the outgoing one was doing. The fader
    // is cleared here rather than left showing the previous song's number.
    decks.clearTempo(deckId);
    void service
      // The SAME master `playablePath` just resolved, cache-relative — the route wants a path
      // inside the cache, not one on the engine's disk.
      .envelope(link, cacheRelPath(s.entry) ?? "")
      .then((env) => {
        setWaves((w) => ({ ...w, [deckId]: { k: "ready", env } }));
        // The tempo arrives WITH the waveform — the sidecar carries both — so this is where
        // the fader gets its scale and its home notch.
        const grid = beatPhase(env.transients, env.bpm);
        const t: DeckTempo = {
          natural: env.bpm,
          seconds: env.seconds,
          target: env.bpm,
          // Measured once, here, from the same onsets the waveform draws: where this song's
          // beat grid starts. Sync needs it to put two decks' downbeats together.
          //
          // Carried ONLY when the onsets really said so. A song whose detected tempo is wrong
          // gives a phase indistinguishable from noise, and moving a record onto that is
          // worse than leaving it where it is — so it syncs the tempo and nothing else.
          ...(grid.confident ? { phase: grid.phase } : {}),
        };
        decks.measured(deckId, t);
      })
      // A waveform that will not come is not worth an error card over the whole desk — the
      // song plays regardless. But the REASON goes into the strip: the analysis needs the
      // engine on that machine, and "no engine binary" is a thing somebody can act on where
      // an empty rectangle is not.
      .catch((e: Error) =>
        setWaves((w) => ({ ...w, [deckId]: { k: "none", why: e.message } })),
      );
  };

  const { loads, tempos, master, mix } = decks;

  const anyLoaded = !!(loads.deckA || loads.deckB);
  const ready = deck.phase.k === "ready";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Anything wrong, across the top. It used to sit in the middle column with the set
          list; the list has gone to the record's own browser, and a fault is not something to
          hide in a column that no longer exists. */}
      {error || decks.deskError || set?.issues.length || decks.problems.length ? (
        <div className="flex shrink-0 flex-col gap-2 px-4 pt-4">
          {/* This view's own trouble — the catalogue, a song with no audio — and the DESK's,
              which the deck document raises and which outlives this tab. Two sources, one card
              each, because "the médiathèque is unreachable" and "the crossfader is bound to
              nothing" are different things to go and fix. */}
          {error ? (
            <Card className="p-3 text-sm text-destructive">{error}</Card>
          ) : null}
          {decks.deskError ? (
            <Card className="p-3 text-sm text-destructive">
              {decks.deskError}
            </Card>
          ) : null}
          {/* A set list that will not parse is the project's problem, not the machine's, so it
              is reported apart from the error above and names its own lines. */}
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
          {/* A binding that names something this project has not got. Reported by CONTROL,
              because that is what looks broken from the desk: you move a fader, nothing
              happens, and this says which line to fix. */}
          {decks.problems.length ? (
            <Card className="p-3 text-sm text-destructive">
              <div className="font-semibold">{MIX_VIEW_FILE}</div>
              {decks.problems.map((p) => (
                <div key={p.control} className="font-mono text-xs">
                  {p.control} : {p.message}
                </div>
              ))}
            </Card>
          ) : null}
        </div>
      ) : null}

      {/* --- the two decks, facing each other -------------------------------------------- */}
      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <DeckSide
          side="A"
          load={loads.deckA}
          spinning={deck.playing}
          wave={waves.deckA}
          playhead={deck.playhead}
          playing={deck.playing}
          tempo={tempos.deckA}
          driven={master === "deckB"}
          onNudge={(bpm) => decks.nudge("deckA", bpm)}
          onCommit={decks.release}
          onPick={() => setBrowsing("deckA")}
          eq={decks.eqOf("deckA")}
          eqLive={decks.eqLive("deckA")}
          onEq={(band, dB) => decks.turnEq("deckA", band, dB)}
          filter={decks.filterOf("deckA")}
          filterLive={decks.filterLive("deckA")}
          onFilter={(v) => decks.turnFilter("deckA", v)}
        />

        <DeckSide
          side="B"
          load={loads.deckB}
          spinning={deck.playing}
          wave={waves.deckB}
          playhead={deck.playhead}
          playing={deck.playing}
          tempo={tempos.deckB}
          driven={master === "deckA"}
          onNudge={(bpm) => decks.nudge("deckB", bpm)}
          onCommit={decks.release}
          onPick={() => setBrowsing("deckB")}
          eq={decks.eqOf("deckB")}
          eqLive={decks.eqLive("deckB")}
          onEq={(band, dB) => decks.turnEq("deckB", band, dB)}
          filter={decks.filterOf("deckB")}
          filterLive={decks.filterLive("deckB")}
          onFilter={(v) => decks.turnFilter("deckB", v)}
        />
      </div>

      {/* One browser, told which deck it is for — two dialogs would be two pieces of state
          able to disagree about which is open. */}
      <SongBrowser
        side={browsing === "deckB" ? "B" : "A"}
        songs={set?.entries ?? []}
        open={browsing !== null}
        onOpenChange={(o) => setBrowsing(o ? browsing : null)}
        onPick={(song) => browsing && load(browsing, song)}
      />

      {/* --- the crossfader, across the bottom ----------------------------------------- */}
      <footer className="flex h-[10%] min-h-[4.5rem] shrink-0 items-center gap-6 border-t px-6">
        {/* At the two ENDS, flanking the crossfader, each under its own deck. The button says
            who LEADS: pressing the left one puts both records on deck A's tempo. */}
        <SyncButton
          side="A"
          on={master === "deckA"}
          enabled={!!tempos.deckA?.natural && !!tempos.deckB?.natural}
          beats={decks.canAlign}
          onClick={() => decks.toggleSync("deckA")}
        />

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
            onChange={(e) => decks.crossfade(Number(e.target.value))}
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
            onDoubleClick={() => decks.crossfade(MIX_CENTRE)}
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

        <SyncButton
          side="B"
          on={master === "deckB"}
          enabled={!!tempos.deckA?.natural && !!tempos.deckB?.natural}
          beats={decks.canAlign}
          onClick={() => decks.toggleSync("deckB")}
        />
      </footer>
    </div>
  );
}

/**
 * One end of the sync pair: "this deck leads".
 *
 * Two buttons, ONE choice — pressing the lit one releases it, because a set spends most of
 * its time with neither deck leading and there has to be a way back to that. Both dark is a
 * state, not an absence of one.
 *
 * Disabled until BOTH decks have a tempo: there is nothing to sync to otherwise, and a
 * button that does nothing when pressed is worse than one that says why it cannot.
 *
 * `beats` is the same rule one step further. Sync does TWO things, and the second one — putting
 * the downbeats together — needs a grid the onsets actually agreed on. A song whose detected
 * tempo is wrong has no such grid (see `beatPhase`), so the speeds still match and the beats
 * do not. The button stays live, because half of sync is worth having, and says which half.
 */
function SyncButton({
  side,
  on,
  enabled,
  beats,
  onClick,
}: {
  side: "A" | "B";
  on: boolean;
  enabled: boolean;
  /** Can the two decks' beats be aligned, or only their tempos? */
  beats: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant={on ? "default" : "secondary"}
      disabled={!enabled}
      className="shrink-0"
      title={
        !enabled
          ? "il faut un tempo sur les deux platines"
          : !beats
            ? `synchroniser sur la platine ${side} — tempo seulement : l'analyse n'a pas trouvé de grille fiable sur l'un des morceaux, les temps ne seront pas calés`
            : on
              ? `la platine ${side} mène — cliquer pour relâcher`
              : `synchroniser sur la platine ${side}`
      }
      onClick={onClick}
    >
      <Link2 className="mr-1 h-3.5 w-3.5" />
      SYNC {side}
    </Button>
  );
}

/** One deck: its tempo fader, the record, its waveform, and what it is holding. */
function DeckSide({
  side,
  load,
  spinning,
  wave,
  playhead,
  playing,
  tempo,
  driven,
  onNudge,
  onCommit,
  onPick,
  eq,
  eqLive,
  onEq,
  filter,
  filterLive,
  onFilter,
}: {
  side: "A" | "B";
  load: DeckLoads[DeckId];
  spinning: boolean;
  wave: Wave | undefined;
  playhead: React.RefObject<Playhead>;
  playing: boolean;
  /** What this deck plays at — already synced, so a slave shows the master's number. */
  tempo: DeckTempo | undefined;
  /** Driven by the other deck: the fader moves on its own and greys out. */
  driven: boolean;
  onNudge: (bpm: number) => void;
  onCommit: () => void;
  /** The record's middle was clicked — open the browser for this deck. */
  onPick: () => void;
  /** This deck's EQ knobs, in dB by band id, and whether they reach anything. */
  eq: Partial<Record<string, number>>;
  eqLive: boolean;
  onEq: (band: string, dB: number) => void;
  /** …and its filter, on the same strip but its own module. */
  filter: number | undefined;
  filterLive: boolean;
  onFilter: (value: number) => void;
}) {
  const fader = (
    <BpmFader
      natural={tempo?.natural ?? 0}
      target={tempo?.target ?? 0}
      driven={driven}
      onChange={onNudge}
      onCommit={onCommit}
    />
  );

  const strip = (
    <ChannelStrip
      eq={eq}
      eqLive={eqLive}
      filter={filter}
      filterLive={filterLive}
      onEq={onEq}
      onFilter={onFilter}
    />
  );

  return (
    <section className="flex min-w-0 flex-1 gap-2">
      {/* The tempo on the OUTER edge, the shaping controls on the INNER one: the two decks
          face each other across the middle, so the desk reads as a mirror rather than a
          repeat and a hand knows which deck it is on without looking up. */}
      {side === "A" ? fader : strip}
      <div className="flex min-w-0 flex-1 flex-col items-center gap-3">
        <Vinyl
          side={side}
          artist={load?.artist ?? null}
          title={load?.title ?? null}
          spinning={spinning && !!load}
          onPick={onPick}
        />
        {/* Under the record, as a deck has it. Only once something is loaded: an empty strip
            under an empty deck is furniture. */}
        {load ? (
          <Waveform
            envelope={wave?.k === "ready" ? wave.env : null}
            playhead={playhead}
            playing={playing}
            analysing={wave?.k === "loading"}
            problem={wave?.k === "none" ? wave.why : null}
          />
        ) : null}
        <div className="w-full truncate text-center text-xs text-muted-foreground">
          {load ? load.title : "rien de chargé"}
        </div>
      </div>
      {side === "B" ? fader : strip}
    </section>
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
