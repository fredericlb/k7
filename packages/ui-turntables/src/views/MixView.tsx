// MixView.tsx — the desk: two decks facing each other, each with its tempo on the outer edge
// and its channel strip on the inner one, and the crossfader across the bottom. What plays
// comes from the project's `songs.yaml`, chosen at the record itself. See ../../docs/mix.md.
//
// It DRAWS the decks and owns nothing about them. The document — what is loaded, what it plays
// at, every gesture that changes either — is `useDeckSet`, held by Studio, because this view is
// unmounted the moment somebody opens the graph and a set does not stop existing then.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { PLAYLISTS_DIR, playlistPathOf } from "@studio/song-schema/playlist";
import type { Stem } from "@studio/song-schema/stems";
import {
  AudioLines,
  Headphones,
  Link2,
  Play,
  RefreshCw,
  Square,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { beatPhase } from "../beats";
import {
  type DeckId,
  type DeckLoads,
  type DeckTempo,
  MIX_CENTRE,
  sourceAt,
} from "../deck";
import { type DeskLayout, deskLayout } from "../deskLayout";
import type { Deck, Playhead } from "../engine";
import { MIX_VIEW_FILE } from "../mixView";
import {
  cacheRelPath,
  type FileLink,
  fileLink,
  playablePath,
  service,
} from "../service";
import {
  NO_PLAYLIST,
  resolveSet,
  type SetEntry,
  type SetList,
} from "../setList";
import { useContentHeight } from "../useContentHeight";
import type { DeckSet } from "../useDeckSet";
import type { Envelope } from "../waveform";
import { BpmFader } from "./BpmFader";
import { ChannelStrip, type StemPrep, StemStrip } from "./ChannelStrip";
import { CueButtons } from "./CueButtons";
import { SongBrowser } from "./SongBrowser";
import { Vinyl } from "./Vinyl";
import { Waveform } from "./Waveform";

/** A deck's waveform — `none` CARRIES ITS REASON, since an empty strip explains nothing on its own. */
type Wave =
  | { k: "loading" }
  | { k: "ready"; env: Envelope }
  | { k: "none"; why: string };

/** How often a running separation is asked how it is going — it reports per WINDOW, a few seconds apart. */
const PREP_POLL_MS = 2000;

export function MixView({
  engine,
  library,
  deck,
  set: decks,
  playlist,
  stems,
  file,
}: {
  /** WHERE the chosen machine's file service is — narrowed to the two fields, see ../../docs/hosting.md. */
  engine: { fileBase: string | null; id: string };
  /** WHERE the hosted library answers — pl8's base, optional: a host without one still draws a desk. */
  library?: { base: string };
  /** The engine link, held by the host so every view shares one. */
  deck: Deck;
  /** The playlist this surface declares, by name — for the messages that must say WHICH file is wrong. */
  playlist?: string;
  /** Does this desk SEPARATE a record handed to it unprepared? — the surface's `stems:`, ../../docs/stems.md. */
  stems?: boolean;
  /** The surface's own file, so "add a `playlist:` line" can name where. */
  file: string;
  /** The decks as a document — everything this view shows and every gesture it forwards. */
  set: DeckSet;
}) {
  // Derived, never typed and never stored: the file service is on the chosen engine's host.
  const link = useMemo(() => fileLink(engine), [engine]);
  const [root, setRoot] = useState<string | null>(null);
  const [set, setSet] = useState<SetList | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per deck. Three states rather than a nullable envelope: "computing" and "never" are two sentences.
  const [waves, setWaves] = useState<Partial<Record<DeckId, Wave>>>({});
  /** Which deck's song browser is open, if any — one dialog, told which deck it is for. */
  const [browsing, setBrowsing] = useState<DeckId | null>(null);
  /** The catch-up per deck: a separation this view started because the record had none. */
  const [preps, setPreps] = useState<Partial<Record<DeckId, StemPrep>>>({});
  /** One token per deck, bumped by every load — how a poll loop with no timer learns it is obsolete. */
  const prepFor = useRef<Partial<Record<DeckId, number>>>({});
  useEffect(
    () => () => {
      prepFor.current = {};
    },
    [],
  );

  const refresh = useCallback(
    async (s: FileLink) => {
      try {
        const sum = await service.summary(s);
        setRoot(sum.root);
        const cached = (await service.songs(s)).entries;
        // TWO sources, and the PLAYLIST decides what is drawn — see ../../docs/setList.md.
        setSet(
          decks.playlistText === undefined
            ? NO_PLAYLIST
            : resolveSet(decks.playlistText, cached),
        );
        setError(null);
      } catch (e) {
        setSet(null);
        setError((e as Error).message);
      }
    },
    [decks.playlistText],
  );

  useEffect(() => {
    // An engine answering on its own port but not the file one: said, since an empty list misleads.
    if (!link)
      return setError(
        "le service de fichiers de cette machine ne répond pas — la médiathèque est injoignable",
      );
    void refresh(link);
  }, [link, refresh]);

  /** Separate what was just put on a deck, when the set says so and the record has none — ../../docs/stems.md. */
  const prepare = async (deckId: DeckId, s: SetEntry, _at: FileLink) => {
    const song = s.entry && cacheRelPath(s.entry, s.file);
    // …and a library to ask: a host that passes none leaves the knobs grey rather than failing.
    if (!song || !stems || !library) return;
    const token = (prepFor.current[deckId] ?? 0) + 1;
    prepFor.current[deckId] = token;
    const mine = () => prepFor.current[deckId] === token;
    const say = (p: StemPrep | undefined) =>
      setPreps((all) => ({ ...all, [deckId]: p }));
    const landed = () => {
      say(undefined);
      decks.stemsArrived(deckId, s.id);
    };

    try {
      const first = await service.prepareStems(library, song, engine.id);
      if (!mine()) return;
      // Already on disk: `meta.stems` is only a scan snapshot, so the machine is the one asked.
      if (first.ready) return landed();

      let job = first.job;
      while (job && !job.done) {
        say({ k: "running", phase: job.phase, percent: job.percent });
        await new Promise((r) => setTimeout(r, PREP_POLL_MS));
        if (!mine()) return;
        try {
          job = await service.separation(library, job.id);
        } catch {
          // Usually a swept job: the other route answers "are the stems on disk" directly, so ask it.
          const again = await service.prepareStems(library, song, engine.id);
          if (!mine()) return;
          if (again.ready) return landed();
          job = again.job;
        }
      }
      if (!mine()) return;
      if (job?.failed)
        say({ k: "failed", why: job.error ?? "raison inconnue" });
      else landed();
    } catch (e) {
      // Said on the column, not the desk's error card: this is one deck's record, the other still plays.
      if (mine()) say({ k: "failed", why: (e as Error).message });
    }
  };

  /** Put a song on a deck: it PLAYS at once, and the analysis lands separately, when it lands. */
  const load = (deckId: DeckId, s: SetEntry) => {
    // `link` is implied by `root` but carried explicitly, so the waveform fetch below assumes nothing.
    if (!deck.engine || !root || !link || !s.entry) return;
    // The line's OWN file, master or variant — reading `meta.master` would play the wrong record.
    const path = playablePath(root, s.entry, s.file);
    // Said out loud: a catalogued folder with no audio is a real state, and a dead button explains nothing.
    if (!path)
      return setError(
        `${s.name} : le dossier est catalogué mais ne porte aucun audio`,
      );
    setError(null);
    decks.putOn(deckId, {
      path,
      // The version is part of what is on the deck — a label naming the master over an instrumental lies.
      title: s.variant ? `${s.name} · ${s.variant}` : s.name,
      artist: s.artist,
      id: s.id,
      // Whether this record has been SEPARATED — it decides whether the four stem lanes are filled.
      stems: !!s.entry.meta?.stems,
    });

    // Any catch-up watching the outgoing record is now obsolete — bumped whether or not a new one starts.
    prepFor.current[deckId] = (prepFor.current[deckId] ?? 0) + 1;
    setPreps((p) => ({ ...p, [deckId]: undefined }));
    // …and the catch-up itself, only when the set asked for it: a separation is minutes of arithmetic.
    if (!s.entry.meta?.stems && stems) void prepare(deckId, s, link);

    setWaves((w) => ({ ...w, [deckId]: { k: "loading" } }));
    // A new record starts at ITS own tempo, whatever the outgoing one was doing.
    decks.clearTempo(deckId);
    void service
      /** The SAME audio the deck plays, cache-relative — `s.file`, not the master, see ../../docs/setList.md. */
      .envelope(link, cacheRelPath(s.entry, s.file) ?? "")
      .then((env) => {
        setWaves((w) => ({ ...w, [deckId]: { k: "ready", env } }));
        // The tempo arrives WITH the waveform — the sidecar carries both.
        const grid = beatPhase(env.transients, env.bpm);
        const t: DeckTempo = {
          natural: env.bpm,
          seconds: env.seconds,
          target: env.bpm,
          // Where the beat grid starts, carried ONLY when the onsets really said so — ../../docs/bpm.md.
          ...(grid.confident ? { phase: grid.phase } : {}),
        };
        decks.measured(deckId, t);
      })
      // No error card: the song plays regardless, but the REASON goes into the strip to be acted on.
      .catch((e: Error) =>
        setWaves((w) => ({ ...w, [deckId]: { k: "none", why: e.message } })),
      );
  };

  const { loads, tempos, master, mix } = decks;

  const anyLoaded = !!(loads.deckA || loads.deckB);
  const ready = deck.phase.k === "ready";

  /** What each deck draws, decided by the room the decks row has — measured, not told: ../../docs/deskLayout.md. */
  const deckRow = useRef<HTMLDivElement>(null);
  const layout = deskLayout(useContentHeight(deckRow));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Anything wrong, across the top: there is no middle column to put it in. */}
      {error ||
      decks.deskError ||
      set?.issues.length ||
      decks.problems.length ? (
        <div className="flex shrink-0 flex-col gap-2 px-4 pt-4">
          {/* This view's own trouble and the DESK's, one card each: they are different things to go and fix. */}
          {error ? (
            <Card className="p-3 text-sm text-destructive">{error}</Card>
          ) : null}
          {decks.deskError ? (
            <Card className="p-3 text-sm text-destructive">
              {decks.deskError}
            </Card>
          ) : null}
          {/* A set list that will not read is the project's problem, so it is reported apart and names its file. */}
          {set?.issues.length ? (
            <Card className="p-3 text-sm text-destructive">
              <div className="font-semibold">
                {playlist ? playlistPathOf(playlist) : PLAYLISTS_DIR}
              </div>
              {set.issues.map((i) => (
                <div key={i} className="font-mono text-xs">
                  {i}
                </div>
              ))}
            </Card>
          ) : null}
          {/* Not an error but a desk pointed at no set list, said with the one line that fixes it. */}
          {set?.absent ? (
            <Card className="p-3 text-sm text-muted-foreground">
              Cette surface ne nomme aucune playlist. Ajoutez une ligne{" "}
              <span className="font-mono">playlist: &lt;nom&gt;</span> dans{" "}
              <span className="font-mono">{file}</span> — les playlists du dépôt
              s'écrivent dans st0, sous la roue dentée.
            </Card>
          ) : null}
          {/* A binding naming something the project has not got, reported by CONTROL: that is what looks broken. */}
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
      <div ref={deckRow} className="flex min-h-0 flex-1 gap-4 p-4">
        <DeckSide
          side="A"
          layout={layout}
          load={loads.deckA}
          spinning={deck.playing}
          wave={waves.deckA}
          playhead={deck.playhead}
          drawNow={deck.drawNow}
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
          stems={decks.stemsOf("deckA")}
          stemLive={decks.stemLive("deckA")}
          stemsReady={decks.stemsReady("deckA")}
          stemPrep={preps.deckA}
          onStem={(s, cut) => decks.turnStem("deckA", s, cut)}
          cues={decks.cuesOf("deckA")}
          onCueJump={(slot) => decks.jumpCue("deckA", slot)}
          onCueSet={(slot, at) => decks.setCue("deckA", slot, at)}
        />

        <DeckSide
          side="B"
          layout={layout}
          load={loads.deckB}
          spinning={deck.playing}
          wave={waves.deckB}
          playhead={deck.playhead}
          drawNow={deck.drawNow}
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
          stems={decks.stemsOf("deckB")}
          stemLive={decks.stemLive("deckB")}
          stemsReady={decks.stemsReady("deckB")}
          stemPrep={preps.deckB}
          onStem={(s, cut) => decks.turnStem("deckB", s, cut)}
          cues={decks.cuesOf("deckB")}
          onCueJump={(slot) => decks.jumpCue("deckB", slot)}
          onCueSet={(slot, at) => decks.setCue("deckB", slot, at)}
        />
      </div>

      {/* One browser, told which deck it is for: two dialogs would be two states able to disagree. */}
      <SongBrowser
        side={browsing === "deckB" ? "B" : "A"}
        songs={set?.entries ?? []}
        open={browsing !== null}
        onOpenChange={(o) => setBrowsing(o ? browsing : null)}
        onPick={(song) => browsing && load(browsing, song)}
      />

      {/* --- the crossfader, across the bottom ----------------------------------------- */}
      <footer className="flex h-[10%] min-h-[4.5rem] shrink-0 items-center gap-6 border-t px-6">
        {/* At the two ENDS, flanking the crossfader: the button says who LEADS, not who follows. */}
        <SyncButton
          side="A"
          on={master === "deckA"}
          enabled={!!tempos.deckA?.natural && !!tempos.deckB?.natural}
          beats={decks.canAlign}
          onClick={() => decks.toggleSync("deckA")}
        />

        {/* Off by default, and absent entirely for a host with no stream player — ../../docs/hosting.md. */}
        {deck.setListening && (
          <label
            className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"
            title="Le son sort déjà de l'interface de cette machine. Cochez pour l'entendre aussi dans cet onglet."
          >
            <input
              type="checkbox"
              checked={!!deck.listening}
              onChange={(e) => deck.setListening?.(e.target.checked)}
            />
            <Headphones className="h-4 w-4" />
            Écouter ici
          </label>
        )}

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
          {/* Double-click the readout to recentre: the one position a mouse drag never lands on exactly. */}
          <button
            type="button"
            onDoubleClick={() => decks.crossfade(MIX_CENTRE)}
            title="double-clic : recentrer"
            className="w-12 shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
          >
            {Math.round(mix * 100)}%
          </button>
        </div>

        {/* Next to the transport since it is about what you HEAR, and dark unless a single beat exists. */}
        <Button
          size="sm"
          variant={decks.clicking ? "default" : "secondary"}
          disabled={!ready || !decks.clickDeck}
          title={
            !ready
              ? "aucun moteur sur cette machine"
              : decks.clickDeck
                ? `métronome sur le temps de la platine ${decks.clickDeck === "deckA" ? "A" : "B"}`
                : // The rule, said as the reason it is off rather than as a rule.
                  "le métronome demande un seul temps : une seule platine chargée, ou les deux synchronisées — et un temps mesuré sur celle qui mène"
          }
          onClick={decks.toggleMetronome}
          aria-pressed={decks.clicking}
        >
          <AudioLines className="h-4 w-4" />
        </Button>

        <Button
          size="sm"
          variant={deck.playing ? "default" : "secondary"}
          disabled={!ready || !anyLoaded}
          // ONE transport for both decks, so this runs the whole document — see ../../docs/mix.md.
          title={
            !ready
              ? "aucun moteur sur cette machine"
              : !anyLoaded
                ? "aucune platine chargée"
                : deck.playing
                  ? "arrêter"
                  : "lancer les deux platines"
          }
          // Not a bare `transport("play")`: play must start where the music is — see `playFrom`.
          onClick={decks.toggleTransport}
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

/** One end of the sync pair: "this deck leads" — two buttons, ONE choice. See ../../docs/bpm.md. */
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
  layout,
  load,
  spinning,
  wave,
  playhead,
  drawNow,
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
  stems,
  stemLive,
  stemsReady,
  stemPrep,
  onStem,
  cues,
  onCueJump,
  onCueSet,
}: {
  side: "A" | "B";
  /** What fits in the height this deck has — the record's size, the waveform's, the title. */
  layout: DeskLayout;
  load: DeckLoads[DeckId];
  spinning: boolean;
  wave: Wave | undefined;
  playhead: React.RefObject<Playhead>;
  /** Where to DRAW the transport — steered, see Deck.drawNow. */
  drawNow: () => number;
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
  /** What this deck is REMOVING of each separated instrument, 0..1. Absent is none of it. */
  stems: Partial<Record<Stem, number>>;
  /** Whether the set wires stem cuts at all — false draws no column. */
  stemLive: boolean;
  /** …and whether the record on it has been separated, which is a different grey. */
  stemsReady: boolean;
  /** …and the separation running to make it so, when the set declared a chain. */
  stemPrep: StemPrep | undefined;
  onStem: (stem: Stem, cut: number) => void;
  /** This deck's eight cue slots, and the two gestures that move them. */
  cues: readonly (number | null)[];
  onCueJump: (slot: number) => void;
  onCueSet: (slot: number, transportSeconds: number) => void;
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

  /** Where the transport is RIGHT NOW — the raw anchor, extrapolated: the one to WRITE DOWN (hosting.md). */
  const transportNow = () =>
    playhead.current.seconds +
    (playing ? (performance.now() - playhead.current.at) / 1000 : 0);

  const strip = (
    <ChannelStrip
      eq={eq}
      eqLive={eqLive}
      filter={filter}
      filterLive={filterLive}
      // The same measurement the column beside it uses — the strip has the same height to fit in.
      layout={layout.strip}
      onEq={onEq}
      onFilter={onFilter}
    />
  );

  return (
    <section className="flex min-w-0 flex-1 gap-2">
      {/* The STEMS on the left of BOTH decks, unmirrored: what they remove belongs to the record. */}
      <StemStrip
        stems={stems}
        live={stemLive}
        ready={stemsReady}
        prep={stemPrep}
        layout={layout.strip}
        onStem={onStem}
      />
      {/* Tempo on the OUTER edge and shaping on the INNER one, so the desk reads as a mirror. */}
      {side === "A" ? fader : strip}
      <div className="flex min-w-0 flex-1 flex-col items-center gap-3">
        {/* The record, only when the deck is tall enough to be worth one — ../../docs/deskLayout.md. */}
        {layout.vinyl > 0 ? (
          <Vinyl
            side={side}
            artist={load?.artist ?? null}
            title={load?.title ?? null}
            spinning={spinning && !!load}
            onPick={onPick}
            // The FILE's clock (`sourceAt`) off the STEERED reader (`drawNow`) — see ../../docs/hosting.md.
            at={() => sourceAt(drawNow(), tempo)}
            length={tempo?.seconds ?? 0}
            markers={cues}
            size={layout.vinyl}
          />
        ) : null}
        {/* Under the record, and ALWAYS drawn even with nothing loaded — ../../docs/deskLayout.md. */}
        <Waveform
          envelope={wave?.k === "ready" ? wave.env : null}
          drawNow={drawNow}
          // The same conversion the record above uses — see `Waveform`'s `tempo`.
          tempo={tempo}
          analysing={wave?.k === "loading"}
          problem={wave?.k === "none" ? wave.why : null}
          height={layout.waveform}
        />
        {/* The cues, under the waveform they refer to, and drawn on an empty deck too. */}
        <CueButtons
          markers={cues}
          onJump={onCueJump}
          onSet={onCueSet}
          // Read on the way DOWN — see `transportNow`.
          now={transportNow}
          disabled={!load}
        />
        {/* What is loaded, in words: it earns its line only where the record's label is absent. */}
        {layout.title ? (
          <div className="w-full truncate text-center text-xs text-muted-foreground">
            {load ? load.title : "rien de chargé"}
          </div>
        ) : null}
      </div>
      {side === "B" ? fader : strip}
    </section>
  );
}
