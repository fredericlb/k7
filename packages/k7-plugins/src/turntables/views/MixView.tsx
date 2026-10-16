// MixView.tsx — the desk: two decks facing each other, each with its tempo on the outer edge
// and its channel strip on the inner one, and the crossfader in the gap between them. What
// plays comes from the project's `songs.yaml`, chosen at the record itself. See ../../docs/mix.md.
//
// A deck's own column is `DeckSide.tsx` and its buttons `DeckButtons.tsx`; what is left here is
// what SITS BETWEEN two decks. Still over 500 lines: the remainder is one component holding the
// state both columns share — the waveforms, the browser, the separation poll — and it has no
// test file, so the next split wants `MixView.test.tsx` first.
import { CueButton, FxButtons, SyncButton } from "./DeckButtons";
import { DeckSide, loopProps, type Wave } from "./DeckSide";
//
// It DRAWS the decks and owns nothing about them. The document — what is loaded, what it plays
// at, every gesture that changes either — is `useDeckSet`, held by Studio, because this view is
// unmounted the moment somebody opens the graph and a set does not stop existing then.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { AudioLines, Laptop, Music, RefreshCw } from "@frediverse/ui/icons";
import type { SongDrag } from "@studio/mediatek/playlistItems";
import { PLAYLISTS_DIR, playlistPathOf } from "@studio/song-schema/playlist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodeText } from "../../CodeText";
import { m } from "../../paraglide/messages.js";
import { beatPhase } from "../beats";
import type { DeckId, DeckTempo } from "../deckVocabulary";
import { deskLayout, stemStripHeight } from "../deskLayout";
import type { Deck } from "../engine";
import { loopSpan } from "../loop";
import { MIX_VIEW_FILE } from "../mixView";
import { NO_PREWARM, type Prewarm, prewarming, prewarmSet } from "../prewarm";
import {
  cacheRelPath,
  type FileLink,
  fileLink,
  playablePath,
  service,
} from "../service";
import {
  entryForDrag,
  NO_PLAYLIST,
  resolveSet,
  type SetEntry,
  type SetList,
} from "../setList";
import { useContentHeight } from "../useContentHeight";
import type { DeckSet } from "../useDeckSet";
import type { StemPrep } from "./ChannelStrip";
import { InSightContext, useWatchSight } from "./inSight";
import { MasterMeter, MixerColumn } from "./MixerColumn";
import { SongBrowser } from "./SongBrowser";

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
  // Which load each deck's waveform answers: a slow analysis of the OUTGOING record must not set the incoming one's tempo.
  const waveFor = useRef<Partial<Record<DeckId, number>>>({});
  // Whether the desk is on screen, for the meters and the records to go still while it is hidden (inSight.ts).
  const rootRef = useRef<HTMLDivElement>(null);
  const inSight = useWatchSight(rootRef);
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
    if (!link) return setError(m["mix.noFileService"]());
    void refresh(link);
  }, [link, refresh]);

  /** Analyse the set list before anybody reaches for it — ../../docs/prewarm.md. */
  const [warm, setWarm] = useState<Prewarm>(NO_PREWARM);
  useEffect(() => {
    if (!link || !set?.entries.length) return;
    // Every song the playlist NAMES and this machine holds; the rest have nothing to analyse.
    const paths = set.entries
      .map((s) => s.entry && cacheRelPath(s.entry, s.file))
      .filter((p): p is string => !!p);
    let alive = true;
    void prewarmSet(
      paths,
      (path) => service.envelope(link, path),
      () => alive,
      setWarm,
    );
    // A second playlist, or a closed desk: the walk stops between songs rather than at the end.
    return () => {
      alive = false;
    };
  }, [link, set]);

  /** Correct the record's tempo IN PL8, then take it locally — see ../../docs/grid.md.
   *
   * The write is here rather than in `useDeckSet` because the library link is: a tempo is a fact
   * about the RECORD, so it goes where the record lives, exactly as a separation does. The local
   * value follows only once pl8 has accepted, so a failed write leaves the fader telling the truth. */
  const correctTempo = (deckId: DeckId, bpm: number) => {
    const load = decks.loads[deckId];
    const song = load && root ? load.path.slice(root.length + 1) : null;
    if (!library || !song || !(bpm > 0)) return;
    void service
      .setSongBpm(library, song, bpm)
      .then(() => decks.correctTempo(deckId, bpm))
      .catch((e: Error) =>
        setError(m["mix.tempoFailed"]({ error: e.message })),
      );
  };

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
        say({ k: "failed", why: job.error ?? m["mix.unknownReason"]() });
      else landed();
    } catch (e) {
      // Said on the column, not the desk's error card: this is one deck's record, the other still plays.
      if (mine()) say({ k: "failed", why: (e as Error).message });
    }
  };

  /** Ask the DISK whether this record is separated — a read, and `meta.stems` is only a scan snapshot. */
  const catchUp = async (deckId: DeckId, s: SetEntry) => {
    const song = s.entry && cacheRelPath(s.entry, s.file);
    if (!song || !library) return;
    const token = prepFor.current[deckId];
    try {
      const held = await service.stemsHeld(library, song);
      // The same obsolescence guard the poll uses: a second record may have landed while this asked.
      if (held.ready && prepFor.current[deckId] === token)
        decks.stemsArrived(deckId, s.id);
    } catch {
      /* the knobs stay grey, which is what they already were — never an error card for a read */
    }
  };

  /** A line dropped from the playlist panel — resolved against THIS surface's set list, or refused by name. */
  const dropped = (deckId: DeckId, drag: SongDrag) => {
    const row = entryForDrag(set?.entries ?? [], drag);
    // A panel may show another playlist than the one the surface names; saying so beats a dead drop.
    if (!row) return setError(m["mix.notInPlaylist"]({ song: drag.song }));
    load(deckId, row);
  };

  /** Put a song on a deck: it PLAYS at once, and the analysis lands separately, when it lands. */
  const load = (deckId: DeckId, s: SetEntry) => {
    // `link` is implied by `root` but carried explicitly, so the waveform fetch below assumes nothing.
    if (!deck.engine || !root || !link || !s.entry) return;
    // The line's OWN file, master or variant — reading `meta.master` would play the wrong record.
    const path = playablePath(root, s.entry, s.file);
    // Said out loud: a catalogued folder with no audio is a real state, and a dead button explains nothing.
    if (!path) return setError(m["mix.noAudio"]({ song: s.name }));
    setError(null);
    decks.putOn(deckId, {
      path,
      // The version is part of what is on the deck — a label naming the master over an instrumental lies.
      title: s.variant ? `${s.name} · ${s.variant}` : s.name,
      artist: s.artist,
      id: s.id,
      // Whether this record has been SEPARATED — it decides whether the four stem lanes are filled.
      stems: !!s.entry.meta?.stems,
      // …and what PL8 holds about the RECORDING: a corrected tempo, and a key somebody typed.
      // Facts about the record, so they arrive with it — mediatek's docs/songs.md.
      ...(typeof s.entry.meta?.bpm === "number"
        ? { bpm: s.entry.meta.bpm }
        : {}),
      ...(typeof s.entry.meta?.key === "string"
        ? { key: s.entry.meta.key }
        : {}),
    });

    // Any catch-up watching the outgoing record is now obsolete — bumped whether or not a new one starts.
    prepFor.current[deckId] = (prepFor.current[deckId] ?? 0) + 1;
    setPreps((p) => ({ ...p, [deckId]: undefined }));
    // …and the catch-up itself, only when the set asked for it: a separation is minutes of arithmetic.
    if (!s.entry.meta?.stems && stems) void prepare(deckId, s, link);
    // Asked or not, ASK THE DISK — a record separated since the listing would stay grey until a reload.
    else if (!s.entry.meta?.stems) void catchUp(deckId, s);

    setWaves((w) => ({ ...w, [deckId]: { k: "loading" } }));
    // A new record starts at ITS own tempo, whatever the outgoing one was doing.
    decks.clearTempo(deckId);
    const load = (waveFor.current[deckId] ?? 0) + 1;
    waveFor.current[deckId] = load;
    const current = () => waveFor.current[deckId] === load;
    void service
      /** The SAME audio the deck plays, cache-relative — `s.file`, not the master, see ../../docs/setList.md. */
      .envelope(link, cacheRelPath(s.entry, s.file) ?? "")
      .then((env) => {
        if (!current()) return;
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
      .catch((e: Error) => {
        if (current())
          setWaves((w) => ({ ...w, [deckId]: { k: "none", why: e.message } }));
      });
  };

  const { loads, tempos, master, mix } = decks;

  const ready = deck.phase.k === "ready";

  /** What each deck draws, decided by the room the decks row has — measured, not told: ../../docs/deskLayout.md. */
  const deckRow = useRef<HTMLDivElement>(null);
  // The stem block only costs height when there is no record for it to sit beside — ../../docs/deskLayout.md.
  const stemLive = decks.stemLive("deckA") || decks.stemLive("deckB");
  // …and the echo costs the STRIP a row, on the same "either deck wires one" rule.
  const echoLive = decks.echoLive("deckA") || decks.echoLive("deckB");
  const layout = deskLayout(useContentHeight(deckRow), stemLive, echoLive);
  /** How tall a deck's TOP row is, which the crossfader restates to land on the cue row's line. */
  const crossfadeHead =
    layout.vinyl > 0
      ? layout.vinyl
      : stemLive
        ? stemStripHeight(layout.strip)
        : 0;

  return (
    <InSightContext.Provider value={inSight}>
      <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
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
                <CodeText text={m["mix.noPlaylist"]({ file })} />
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
            spinning={decks.running("deckA")}
            wave={waves.deckA}
            tempo={tempos.deckA}
            driven={master === "deckB"}
            onNudge={(bpm) => decks.nudge("deckA", bpm)}
            onCommit={decks.release}
            keylock={decks.keylock("deckA")}
            onKeylock={() => decks.toggleKeylock("deckA")}
            corrected={decks.gridOf("deckA").bpm !== undefined}
            songKey={decks.keyOf("deckA")}
            onHalve={
              library && tempos.deckA?.natural
                ? () => correctTempo("deckA", tempos.deckA!.natural / 2)
                : undefined
            }
            onDouble={
              library && tempos.deckA?.natural
                ? () => correctTempo("deckA", tempos.deckA!.natural * 2)
                : undefined
            }
            onPick={() => setBrowsing("deckA")}
            onDropSong={(d) => dropped("deckA", d)}
            trim={decks.trimOf("deckA")}
            trimLive={decks.trimLive("deckA")}
            onTrim={(dB) => decks.turnTrim("deckA", dB)}
            eq={decks.eqOf("deckA")}
            eqLive={decks.eqLive("deckA")}
            onEq={(band, dB) => decks.turnEq("deckA", band, dB)}
            filter={decks.filterOf("deckA")}
            filterLive={decks.filterLive("deckA")}
            onFilter={(v) => decks.turnFilter("deckA", v)}
            echo={decks.echoOf("deckA")}
            echoLive={decks.echoLive("deckA")}
            onEcho={(v) => decks.turnEcho("deckA", v)}
            stems={decks.stemsOf("deckA")}
            stemLive={decks.stemLive("deckA")}
            stemsReady={decks.stemsReady("deckA")}
            stemPrep={preps.deckA}
            onStem={(s, cut) => decks.turnStem("deckA", s, cut)}
            cues={decks.cuesOf("deckA")}
            onCueJump={(slot) => decks.jumpCue("deckA", slot)}
            onCueSet={(slot, at) => decks.setCue("deckA", slot, at)}
            onShove={(seconds) => decks.shove("deckA", seconds)}
            loop={loopProps(decks, "deckA")}
            loopSpan={loopSpan(decks.loopOf("deckA"), decks.tempos.deckA)}
            needle={() => decks.sourceNow("deckA")}
            running={decks.running("deckA")}
            onToggleDeck={
              decks.canStartAlone("deckA")
                ? () => decks.toggleDeck("deckA")
                : undefined
            }
            onScratch={
              decks.canScratch("deckA")
                ? (rate) => decks.scratch("deckA", rate)
                : undefined
            }
          />

          {/* Between the two, where a hand crosses from one to the other — ../../docs/mix.md.
            The two CHANNEL faders live here too, over the crossfader, which is a mixing desk's
            own layout and what this column was empty for. */}
          <MixerColumn
            mix={mix}
            quantise={decks.quantise}
            onQuantise={decks.toggleQuantise}
            layout={layout}
            head={crossfadeHead}
            ready={ready}
            levels={{
              deckA: decks.levelOf("deckA") ?? 0,
              deckB: decks.levelOf("deckB") ?? 0,
            }}
            levelLive={{
              deckA: decks.levelLive("deckA"),
              deckB: decks.levelLive("deckB"),
            }}
            meterTracks={{
              deckA: decks.meterTrack("deckA"),
              deckB: decks.meterTrack("deckB"),
            }}
            trackOrder={decks.trackOrder}
            onLevel={(deckId, dB) => decks.turnLevel(deckId, dB)}
            onChange={decks.crossfade}
          />

          <DeckSide
            side="B"
            layout={layout}
            load={loads.deckB}
            spinning={decks.running("deckB")}
            wave={waves.deckB}
            tempo={tempos.deckB}
            driven={master === "deckA"}
            onNudge={(bpm) => decks.nudge("deckB", bpm)}
            onCommit={decks.release}
            keylock={decks.keylock("deckB")}
            onKeylock={() => decks.toggleKeylock("deckB")}
            corrected={decks.gridOf("deckB").bpm !== undefined}
            songKey={decks.keyOf("deckB")}
            onHalve={
              library && tempos.deckB?.natural
                ? () => correctTempo("deckB", tempos.deckB!.natural / 2)
                : undefined
            }
            onDouble={
              library && tempos.deckB?.natural
                ? () => correctTempo("deckB", tempos.deckB!.natural * 2)
                : undefined
            }
            onPick={() => setBrowsing("deckB")}
            onDropSong={(d) => dropped("deckB", d)}
            trim={decks.trimOf("deckB")}
            trimLive={decks.trimLive("deckB")}
            onTrim={(dB) => decks.turnTrim("deckB", dB)}
            eq={decks.eqOf("deckB")}
            eqLive={decks.eqLive("deckB")}
            onEq={(band, dB) => decks.turnEq("deckB", band, dB)}
            filter={decks.filterOf("deckB")}
            filterLive={decks.filterLive("deckB")}
            onFilter={(v) => decks.turnFilter("deckB", v)}
            echo={decks.echoOf("deckB")}
            echoLive={decks.echoLive("deckB")}
            onEcho={(v) => decks.turnEcho("deckB", v)}
            stems={decks.stemsOf("deckB")}
            stemLive={decks.stemLive("deckB")}
            stemsReady={decks.stemsReady("deckB")}
            stemPrep={preps.deckB}
            onStem={(s, cut) => decks.turnStem("deckB", s, cut)}
            cues={decks.cuesOf("deckB")}
            onCueJump={(slot) => decks.jumpCue("deckB", slot)}
            onCueSet={(slot, at) => decks.setCue("deckB", slot, at)}
            onShove={(seconds) => decks.shove("deckB", seconds)}
            loop={loopProps(decks, "deckB")}
            loopSpan={loopSpan(decks.loopOf("deckB"), decks.tempos.deckB)}
            needle={() => decks.sourceNow("deckB")}
            running={decks.running("deckB")}
            onToggleDeck={
              decks.canStartAlone("deckB")
                ? () => decks.toggleDeck("deckB")
                : undefined
            }
            onScratch={
              decks.canScratch("deckB")
                ? (rate) => decks.scratch("deckB", rate)
                : undefined
            }
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

          {/* Deck A's two MOMENTARY gestures, beside its sync — see ../../docs/fx.md. */}
          <FxButtons
            side="A"
            censorable={decks.canCensor("deckA")}
            onCensor={(on) => decks.censor("deckA", on)}
            echoLive={decks.echoLive("deckA")}
            echoingOut={decks.echoingOut("deckA")}
            onEchoOut={(on) => decks.echoOut("deckA", on)}
          />

          {/* Off by default, and absent entirely for a host with no stream player — ../../docs/hosting.md. */}
          {deck.setListening && (
            <label
              className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"
              title={m["mix.listenTitle"]()}
            >
              <input
                type="checkbox"
                checked={!!deck.listening}
                onChange={(e) => deck.setListening?.(e.target.checked)}
              />
              {/* A laptop, not headphones: the CUE buttons own that icon, and this one is about THIS TAB. */}
              <Laptop className="h-4 w-4" />
              {m["mix.listen"]()}
            </label>
          )}

          {/* What the crossfader used to fill: it lives BETWEEN the decks now, on the cue row's line. */}
          <div className="min-w-0 flex-1" />

          {/* The headphones, beside the metronome: both are about what YOU hear and not what the room does. */}
          <CueButton
            side="A"
            on={decks.cueOn("deckA")}
            wired={decks.cueWired("deckA")}
            live={ready && decks.cueLive("deckA")}
            onClick={() => decks.toggleCue("deckA")}
          />
          <CueButton
            side="B"
            on={decks.cueOn("deckB")}
            wired={decks.cueWired("deckB")}
            live={ready && decks.cueLive("deckB")}
            onClick={() => decks.toggleCue("deckB")}
          />

          {/* Next to the transport since it is about what you HEAR, and dark unless a single beat exists. */}
          <Button
            size="sm"
            variant={decks.clicking ? "default" : "secondary"}
            disabled={!ready || !decks.clickDeck}
            title={
              !ready
                ? m["mix.noEngine"]()
                : decks.clickDeck
                  ? m["mix.metronome"]({
                      side: decks.clickDeck === "deckA" ? "A" : "B",
                    })
                  : // The rule, said as the reason it is off rather than as a rule.
                    m["mix.metronomeOff"]()
            }
            onClick={decks.toggleMetronome}
            aria-pressed={decks.clicking}
          >
            <AudioLines className="h-4 w-4" />
          </Button>

          {/* Only while there is something left to analyse — ../../docs/prewarm.md. */}
          {prewarming(warm) ? (
            <span
              className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums"
              title={m[warm.failed ? "mix.prewarmFailed" : "mix.prewarm"](warm)}
            >
              <Music className="size-3" /> {warm.done}/{warm.total}
            </span>
          ) : null}

          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 text-xs"
            title={m["mix.refresh"]()}
            onClick={() => link && void refresh(link)}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>

          {/* The BLEND, and the only meter here that reads it — a channel meter is pre-fader. */}
          <MasterMeter />

          <FxButtons
            side="B"
            censorable={decks.canCensor("deckB")}
            onCensor={(on) => decks.censor("deckB", on)}
            echoLive={decks.echoLive("deckB")}
            echoingOut={decks.echoingOut("deckB")}
            onEchoOut={(on) => decks.echoOut("deckB", on)}
          />

          <SyncButton
            side="B"
            on={master === "deckB"}
            enabled={!!tempos.deckA?.natural && !!tempos.deckB?.natural}
            beats={decks.canAlign}
            onClick={() => decks.toggleSync("deckB")}
          />
        </footer>
      </div>
    </InSightContext.Provider>
  );
}

/** THIS deck's transport, at the foot of its tempo column. Drawn GREYED with nothing on the deck. */
