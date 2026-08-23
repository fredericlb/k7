// MixView.tsx — the desk: two decks facing each other, each with its tempo on the outer edge
// and its channel strip on the inner one, and the crossfader across the bottom. What plays
// comes from the project's `songs.yaml`, chosen at the record itself. See ../../docs/mix.md.
//
// It DRAWS the decks and owns nothing about them. The document — what is loaded, what it plays
// at, every gesture that changes either — is `useDeckSet`, held by Studio, because this view is
// unmounted the moment somebody opens the graph and a set does not stop existing then.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { PLAYLISTS_DIR, playlistPathOf } from "@studio/song/playlist";
import type { Stem } from "@studio/song/stems";
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

/** How often a running separation is asked how it is getting on. It reports per WINDOW — about
 *  one every few seconds on a CPU — so anything faster asks the same number twice. */
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
  /**
   * WHERE the chosen machine's file service is — the one thing this view wants from an engine
   * that is not on `deck`.
   *
   * Narrowed to the one field when st0 became the second host. It was `RankedEngine<PublicEngine>`
   * and used for exactly this, on one line: `fileLink(engine)`. A prop that asked for a whole
   * probe reply would have forced any host without one to fabricate the other fifteen fields,
   * which is the difference between a seam and a shape m9 happened to have.
   */
  engine: { fileBase: string | null; id: string };
  /**
   * WHERE the hosted library answers — pl8's API base on this origin.
   *
   * The second seam, and the reason it appeared: separating a record is pl8's work now, because
   * pl8 holds the master (apps/pl8/docs/stems.md). Optional, so a host that has no library to
   * point at still draws a desk — the knobs then say a record has no stems, which is true, rather
   * than the view failing to render.
   */
  library?: { base: string };
  /** The engine link, held by the host so every view shares one. */
  deck: Deck;
  /** The playlist this surface declares, by name — for the two messages that have to say
   *  WHICH file is wrong. The list itself comes off `set`, already read. */
  playlist?: string;
  /**
   * Does this desk SEPARATE a record it is handed unprepared? — the surface's `stems:`.
   *
   * True turns "this record has no stems" from a dead end into a job: putting an unprepared
   * record on a deck starts the separation here and now. False and the knobs say so, with
   * `playlist stems` as the way.
   *
   * A boolean and not a chain ref. WHICH chain separates is the machine's one answer
   * (`system stems`, kept in preferences.yaml), so nothing on this side spells it — see
   * `service.prepareStems` and ../../docs/stems.md.
   */
  stems?: boolean;
  /** The surface's own file, so "add a `playlist:` line" can name where. */
  file: string;
  /** The decks as a document — everything this view shows and every gesture it forwards. */
  set: DeckSet;
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
  /** The catch-up per deck: a separation this view started because the record had none. */
  const [preps, setPreps] = useState<Partial<Record<DeckId, StemPrep>>>({});
  /**
   * One token per deck, bumped by every load, and the way a poll loop learns it is obsolete.
   *
   * A separation runs for minutes and its loop is an async function that awaits a fetch — so
   * there is no timer to clear and no effect to tear down. Comparing a captured token against
   * this is what makes taking the record off stop the loop, and unmounting is the same event.
   */
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
        // TWO sources, and the PLAYLIST is the one that decides what is drawn: it says which
        // songs are to hand tonight, the cache listing says which of them this machine can
        // play. A song in the set and not in the cache is a line, not an omission.
        //
        // The playlist's text comes from the deck document, which read it once from the name
        // the surface declares — so the browser and the desk can never be looking at two
        // versions of the same set list.
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
   * Separate what has just been put on a deck, when the set says how and the record has none.
   *
   * The other half of `playlist stems`: that verb prepares a set list the night before, this
   * catches up on the record somebody put on anyway. Same registry, same worker, same files —
   * the id hashes the WORK, so putting the same record on twice, or on both decks, joins the run
   * already in flight rather than starting a second hour of arithmetic.
   *
   * Started here rather than in the deck document for the same reason the waveform is: a job
   * belongs to THIS machine and THIS tab, where what is on a deck outlives both.
   *
   * The deck plays throughout. Its stem lanes stay empty until the files exist, and an empty lane
   * subtracts nothing — so the catch-up costs the record nothing but the knobs being grey while
   * it runs (see ../../docs/stems.md).
   */
  const prepare = async (deckId: DeckId, s: SetEntry, _at: FileLink) => {
    const song = s.entry && cacheRelPath(s.entry, s.file);
    // …and a library to ask. A host that passes none has nowhere to separate: the knobs stay
    // grey, which is what an unprepared record already looks like, rather than a failure card
    // about a service this desk was never given.
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
      // Already on disk. The flag this was decided from is a scan snapshot, so the machine gets
      // asked again and a prepared record simply lights its knobs, with no job at all.
      if (first.ready) return landed();

      let job = first.job;
      while (job && !job.done) {
        say({ k: "running", phase: job.phase, percent: job.percent });
        await new Promise((r) => setTimeout(r, PREP_POLL_MS));
        if (!mine()) return;
        try {
          job = await service.separation(library, job.id);
        } catch {
          // Usually the registry having swept a job this tab was still watching — it keeps a
          // finished one for five minutes. The question underneath is "are the stems on disk",
          // which the other route answers directly, so one trip back through it turns that into
          // `ready` rather than into a failure about a record that is prepared.
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
      // Said on the column rather than on the desk's error card: this is one deck's record, and
      // the other one is unaffected and still playing.
      if (mine()) say({ k: "failed", why: (e as Error).message });
    }
  };

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
    // The line's OWN file, which is the master unless the playlist named a variant. Reading
    // `meta.master` here would put the original on for a set list that asked for the
    // instrumental — see `SetEntry.file`.
    const path = playablePath(root, s.entry, s.file);
    // Said out loud rather than swallowed: a catalogued folder with no audio is a real state
    // — a mirror that failed halfway — and a dead button explains nothing.
    if (!path)
      return setError(
        `${s.name} : le dossier est catalogué mais ne porte aucun audio`,
      );
    setError(null);
    decks.putOn(deckId, {
      path,
      // The version is part of what is on the deck: a label reading "Danse" while the
      // instrumental plays is the desk lying in front of an audience.
      title: s.variant ? `${s.name} · ${s.variant}` : s.name,
      artist: s.artist,
      id: s.id,
      // Whether this record has been SEPARATED — the scan reports it beside the master, off the
      // folder's own dirents. It decides whether the four stem lanes are filled at all: a song
      // nobody prepared plays as itself, with its stem knobs greyed and saying why.
      stems: !!s.entry.meta?.stems,
    });

    // Any catch-up watching the outgoing record is now obsolete — bumped whether or not a new
    // one starts, so taking a prepared song off a deck mid-separation ends the loop too.
    prepFor.current[deckId] = (prepFor.current[deckId] ?? 0) + 1;
    setPreps((p) => ({ ...p, [deckId]: undefined }));
    // …and the catch-up itself, for a record nobody prepared. Only when the set names a chain:
    // a separation is minutes of arithmetic, so it happens because the project ASKED for it.
    if (!s.entry.meta?.stems && stems) void prepare(deckId, s, link);

    setWaves((w) => ({ ...w, [deckId]: { k: "loading" } }));
    // A new record starts at ITS own tempo, whatever the outgoing one was doing. The fader
    // is cleared here rather than left showing the previous song's number.
    decks.clearTempo(deckId);
    void service
      /**
       * The SAME audio `playablePath` just resolved, cache-relative — the route wants a path
       * inside the cache, not one on the engine's disk.
       *
       * `s.file` is what makes that true, and it was missing: this asked for the MASTER while
       * the deck played whatever the playlist line named. A line naming a variant therefore
       * drew the original's waveform, measured the original's tempo, and handed the fader the
       * original's length — silently, and only for the lines that name one, which is why it
       * survived. An instrumental is the same song at the same tempo often enough to look
       * right and be wrong; an edit is not.
       */
      .envelope(link, cacheRelPath(s.entry, s.file) ?? "")
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

  /**
   * What each deck draws, decided by the room the decks row actually has.
   *
   * Measured rather than told. This surface is a PANE (`layout: split`), so its height is the
   * layout's business and changes without this component being re-mounted or re-propped: half
   * the column beside the graph, the whole window under `full`, a third of a phone in
   * landscape. A `compact` boolean handed down from st0 would be st0 guessing at a number it
   * does not have either.
   *
   * The row is the thing observed because it is the box the decks are given — `contentRect`
   * takes its padding off, so `deskLayout` is handed exactly what a `DeckSide` can use.
   */
  const deckRow = useRef<HTMLDivElement>(null);
  const layout = deskLayout(useContentHeight(deckRow));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Anything wrong, across the top. It used to sit in the middle column with the set
          list; the list has gone to the record's own browser, and a fault is not something to
          hide in a column that no longer exists. */}
      {error ||
      decks.deskError ||
      set?.issues.length ||
      decks.problems.length ? (
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
          {/* A set list that will not read is the project's problem, not the machine's, so it
              is reported apart from the error above and names the file it is about. */}
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
          {/* Not an error: a desk nobody has pointed at a set list yet. Said where the songs
              would be, with the one line that fixes it — an empty browser on its own reads as
              an empty médiathèque, which sends you looking in the wrong place. */}
          {set?.absent ? (
            <Card className="p-3 text-sm text-muted-foreground">
              Cette surface ne nomme aucune playlist. Ajoutez une ligne{" "}
              <span className="font-mono">playlist: &lt;nom&gt;</span> dans{" "}
              <span className="font-mono">{file}</span> — les playlists du dépôt
              s'écrivent dans st0, sous la roue dentée.
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
            doubles it. On a laptop with no monitors it is the only way to hear anything.

            Absent entirely for a host with no stream player — see `Deck.setListening`. A
            checkbox that cannot be honoured is worse than no checkbox: it says the sound could
            be here, and the only thing it changes is your confidence about why it is not. */}
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

        {/* Next to the transport, because it is about what you HEAR rather than about either
            deck. Dark unless a single beat exists to click on — one deck, or a sync. */}
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
          // `decks.toggleTransport`, not a bare `transport("play")`: play has to start where the
          // music is, and a deck's clip begins ten minutes in. See `playFrom`.
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

  /**
   * Where the transport is, RIGHT NOW — the raw anchor plus however long ago it landed.
   *
   * The frames arrive ~20×/s, so the last number received can be 50 ms stale, and on a downbeat
   * that is audible when a cue is dropped. This is the estimate to WRITE DOWN: nothing is
   * smoothed, so nothing is traded away. `drawNow` is its counterpart for what is looked at.
   */
  const transportNow = () =>
    playhead.current.seconds +
    (playing ? (performance.now() - playhead.current.at) / 1000 : 0);

  const strip = (
    <ChannelStrip
      eq={eq}
      eqLive={eqLive}
      filter={filter}
      filterLive={filterLive}
      // The same measurement the column beside it uses: the strip is the deck's other half and
      // has the same height to fit in — which it did not know, and the filter paid for it.
      layout={layout.strip}
      onEq={onEq}
      onFilter={onFilter}
    />
  );

  return (
    <section className="flex min-w-0 flex-1 gap-2">
      {/* The STEMS, to the left of the deck — on both, unlike the mirrored pair below.
          Deliberately not mirrored: what these four knobs remove is a property of the record
          rather than of the desk's geometry, and a hand looking for "the bass of the deck on
          the right" should not have to know which side of it the column is on today. */}
      <StemStrip
        stems={stems}
        live={stemLive}
        ready={stemsReady}
        prep={stemPrep}
        layout={layout.strip}
        onStem={onStem}
      />
      {/* The tempo on the OUTER edge, the shaping controls on the INNER one: the two decks
          face each other across the middle, so the desk reads as a mirror rather than a
          repeat and a hand knows which deck it is on without looking up. */}
      {side === "A" ? fader : strip}
      <div className="flex min-w-0 flex-1 flex-col items-center gap-3">
        {/* The record, when the deck is tall enough to be worth one. In a PANE it usually is
            not, and its absence is the feature rather than a degradation: everything it says —
            how far through, where the cues are, that it is moving — the waveform below says
            too, and says what is COMING as well. See ../deskLayout.ts. */}
        {layout.vinyl > 0 ? (
          <Vinyl
            side={side}
            artist={load?.artist ?? null}
            title={load?.title ?? null}
            spinning={spinning && !!load}
            onPick={onPick}
            // The FILE's clock for both, so a stretched deck is not drawn further through its
            // record than an unstretched one at the same bar — see `sourceAt`. DRAWN, so the
            // steered reader: a wedge redrawn at 60 fps off the raw anchor carries the frames'
            // arrival jitter straight into the record's progress.
            at={() => sourceAt(drawNow(), tempo)}
            length={tempo?.seconds ?? 0}
            markers={cues}
            size={layout.vinyl}
          />
        ) : null}
        {/* Under the record, as a deck has it — and the deck's ONE control once the record is
            gone, which is why it takes the height that was freed.

            ALWAYS drawn, loaded or not. It was conditional on `load`, on the grounds that an
            empty strip under an empty deck is furniture; that is the same argument `CueButtons`
            below already refuses, and for the better reason. A desk whose controls appear and
            vanish with what is loaded is a desk that moves under your hands: the strip would
            push the cues and the title down the moment a song landed, and the place the eye has
            learned to look would not be there to learn. Empty says "nothing yet"; absent says
            "look somewhere else" — and this is also where "analyse du morceau…" and a failed
            analysis get said, neither of which can be read on a strip that is not there. */}
        <Waveform
          envelope={wave?.k === "ready" ? wave.env : null}
          drawNow={drawNow}
          // The same conversion the record above uses — see `Waveform`'s `tempo`.
          tempo={tempo}
          analysing={wave?.k === "loading"}
          problem={wave?.k === "none" ? wave.why : null}
          height={layout.waveform}
        />
        {/* The cues, under the waveform they refer to — and drawn on an empty deck too, so
            the desk does not reshuffle itself the moment a song lands. */}
        <CueButtons
          markers={cues}
          onJump={onCueJump}
          onSet={onCueSet}
          // Read on the way DOWN — see `transportNow`.
          now={transportNow}
          disabled={!load}
        />
        {/* What is loaded, in words. Dropped on the shortest decks only — the record's label
            says the same thing whenever there IS a record, so this earns its line precisely
            when there is not. */}
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
