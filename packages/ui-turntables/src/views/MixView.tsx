// MixView.tsx — the desk: two decks facing each other, each with its tempo on the outer edge
// and its channel strip on the inner one, and the crossfader in the gap between them. What
// plays comes from the project's `songs.yaml`, chosen at the record itself. See ../../docs/mix.md.
//
// It DRAWS the decks and owns nothing about them. The document — what is loaded, what it plays
// at, every gesture that changes either — is `useDeckSet`, held by Studio, because this view is
// unmounted the moment somebody opens the graph and a set does not stop existing then.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import {
  parseSongDrag,
  SONG_DRAG_TYPE,
  type SongDrag,
} from "@studio/mediatek/playlistItems";
import { PLAYLISTS_DIR, playlistPathOf } from "@studio/song-schema/playlist";
import type { Stem } from "@studio/song-schema/stems";
import {
  AudioLines,
  Headphones,
  Laptop,
  Link2,
  Play,
  RefreshCw,
  Repeat,
  Square,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { beatPhase } from "../beats";
import type { DeckId, DeckLoads, DeckTempo } from "../deck";
import { type DeskLayout, deskLayout, stemStripHeight } from "../deskLayout";
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
import type { Envelope } from "../waveform";
import { BpmFader } from "./BpmFader";
import { ChannelStrip, type StemPrep, StemStrip } from "./ChannelStrip";
import { CueButtons } from "./CueButtons";
import { LoopRow } from "./LoopRow";
import { MasterMeter, MixerColumn } from "./MixerColumn";
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
        setError(
          `le tempo n'a pas pu être corrigé dans la médiathèque : ${e.message}`,
        ),
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
        say({ k: "failed", why: job.error ?? "raison inconnue" });
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
    if (!row)
      return setError(
        `${drag.song} : ce morceau n'est pas dans la playlist de cette surface`,
      );
    load(deckId, row);
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
          loopSpan={loopSpan(decks.loopOf("deckA"), decks.tempos["deckA"])}
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
          loopSpan={loopSpan(decks.loopOf("deckB"), decks.tempos["deckB"])}
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
            title="Le son sort déjà de l'interface de cette machine. Cochez pour l'entendre aussi dans cet onglet."
          >
            <input
              type="checkbox"
              checked={!!deck.listening}
              onChange={(e) => deck.setListening?.(e.target.checked)}
            />
            {/* A laptop, not headphones: the CUE buttons own that icon, and this one is about THIS TAB. */}
            <Laptop className="h-4 w-4" />
            Écouter ici
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

        {/* Only while there is something left to analyse — ../../docs/prewarm.md. */}
        {prewarming(warm) ? (
          <span
            className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums"
            title={
              `analyse de la playlist : ${warm.done}/${warm.total} morceaux` +
              (warm.failed ? ` (${warm.failed} illisible(s))` : "") +
              " — un morceau analysé pose son tempo et allume SYNC tout de suite"
            }
          >
            ♪ {warm.done}/{warm.total}
          </span>
        ) : null}

        <Button
          size="sm"
          variant="ghost"
          className="shrink-0 text-xs"
          title="Relire le cache de la médiathèque"
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
  );
}

/** THIS deck's transport, at the foot of its tempo column. Drawn GREYED with nothing on the deck. */
function DeckPlay({
  side,
  running,
  onToggle,
}: {
  side: "A" | "B";
  running: boolean;
  /** Absent when this deck holds no record — the button stays, disabled. See ../../docs/mix.md. */
  onToggle?: () => void;
}) {
  return (
    <Button
      size="sm"
      // Full width and the same height as KEY above it: the foot of the column is one block of two.
      className="h-12 w-full shrink-0 px-0"
      variant={running ? "default" : "secondary"}
      disabled={!onToggle}
      title={
        !onToggle
          ? `platine ${side} vide — rien à lancer`
          : running
            ? `arrêter la platine ${side} — l'autre continue`
            : `lancer la platine ${side} seule`
      }
      onClick={onToggle}
      aria-pressed={running}
    >
      {running ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
    </Button>
  );
}

/** A deck's two MOMENTARY effects — held, never toggled. See ../../docs/fx.md.
 *
 * `onPointerUp` AND `onPointerLeave`, because a press that ends off the button still has to end:
 * without the second one a censor whose hand slid away leaves the record running backwards. */
function FxButtons({
  side,
  censorable,
  onCensor,
  echoLive,
  echoingOut,
  onEchoOut,
}: {
  side: "A" | "B";
  /** A record has to be on the deck for running it backwards to mean anything. */
  censorable: boolean;
  onCensor: (on: boolean) => void;
  /** Does the project wire an echo for this deck? Unwired is ordinary, like an unwired cue. */
  echoLive: boolean;
  echoingOut: boolean;
  onEchoOut: (on: boolean) => void;
}) {
  const held = (on: (down: boolean) => void, enabled: boolean) =>
    enabled
      ? {
          onPointerDown: () => on(true),
          onPointerUp: () => on(false),
          onPointerLeave: () => on(false),
        }
      : {};
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={!censorable}
        className="shrink-0 px-2 text-xs"
        title={
          censorable
            ? `censurer la platine ${side} — le disque part à l'envers tant que le bouton est tenu`
            : `platine ${side} vide — rien à censurer`
        }
        {...held(onCensor, censorable)}
      >
        <Undo2 className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        variant={echoingOut ? "default" : "secondary"}
        disabled={!echoLive}
        className="shrink-0 px-2 text-xs"
        title={
          echoLive
            ? `echo-out sur la platine ${side} — coupe la voie et laisse l'écho sonner`
            : `cette platine n'a pas d'écho câblé — reliez \`deck${side}.echo\` dans surfaces/`
        }
        aria-pressed={echoingOut}
        {...held(onEchoOut, echoLive)}
      >
        <Repeat className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/** One deck in the headphones — pre-fade, so the crossfader does not reach it. See ../../docs/cue.md. */
function CueButton({
  side,
  on,
  wired,
  live,
  onClick,
}: {
  side: "A" | "B";
  on: boolean;
  /** Does the PROJECT wire a send for this deck? Unwired is ordinary, not a fault — ../../docs/cue.md. */
  wired: boolean;
  /** …and can this MACHINE play it? Two halves, two sentences: a button that lit and lied is worse. */
  live: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant={on ? "default" : "secondary"}
      disabled={!live}
      className="shrink-0"
      title={
        // The reason, not the rule — and WHICH of the two is missing, since the fixes are different.
        !wired
          ? `cette platine n'a pas de départ casque — migrez le set (migrateSetCue) ou reliez \`deck${side}.cue\` dans surfaces/`
          : !live
            ? "cette machine n'a pas de paire pour le casque — nommez-la avec `system cue 3+4`, sinon le cue ne joue nulle part"
            : on
              ? `la platine ${side} est dans le casque — cliquer pour l'enlever`
              : `écouter la platine ${side} au casque, avant le crossfader`
      }
      onClick={onClick}
      aria-pressed={on}
    >
      <Headphones className="mr-1 h-3.5 w-3.5" />
      {side}
    </Button>
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
/** What a deck column needs to draw its loop row. Gathered so both decks say it once. */
interface LoopProps {
  beats: number | null;
  rolling: boolean;
  pending: boolean;
  step: number;
  can: boolean;
  onJump: (beats: number) => void;
  onIn: () => void;
  onOut: () => void;
  onLength: (beats: number) => void;
  onResize: (factor: number) => void;
  onRoll: (down: boolean) => void;
}

/** …read off the desk, so a third deck would not mean a third copy of these eleven lines. */
function loopProps(decks: DeckSet, deckId: DeckId): LoopProps {
  const on = decks.loopOf(deckId);
  return {
    beats: on?.beats ?? null,
    rolling: !!on?.roll,
    pending: decks.pendingOf(deckId) !== null,
    step: decks.stepOf(deckId),
    can: decks.canLoop(deckId),
    onJump: (beats) => decks.beatJump(deckId, beats),
    onIn: () => decks.loopIn(deckId),
    onOut: () => decks.loopOut(deckId),
    onLength: (beats) => decks.setLoop(deckId, beats),
    onResize: (factor) => decks.resizeLoop(deckId, factor),
    // The roll takes the length the buttons last agreed on — there is no separate roll size.
    onRoll: (down) => decks.roll(deckId, decks.stepOf(deckId), down),
  };
}

function DeckSide({
  side,
  layout,
  load,
  spinning,
  wave,
  tempo,
  driven,
  onNudge,
  onCommit,
  keylock,
  onKeylock,
  corrected,
  songKey,
  onHalve,
  onDouble,
  onPick,
  onDropSong,
  trim,
  trimLive,
  onTrim,
  eq,
  eqLive,
  onEq,
  filter,
  filterLive,
  onFilter,
  echo,
  echoLive,
  onEcho,
  stems,
  stemLive,
  stemsReady,
  stemPrep,
  onStem,
  cues,
  onCueJump,
  onCueSet,
  loop,
  loopSpan,
  onShove,
  needle,
  running,
  onToggleDeck,
  onScratch,
}: {
  side: "A" | "B";
  /** What fits in the height this deck has — the record's size, the waveform's, the title. */
  layout: DeskLayout;
  load: DeckLoads[DeckId];
  spinning: boolean;
  wave: Wave | undefined;
  /** What this deck plays at — already synced, so a slave shows the master's number. */
  tempo: DeckTempo | undefined;
  /** Driven by the other deck: the fader moves on its own and greys out. */
  driven: boolean;
  onNudge: (bpm: number) => void;
  onCommit: () => void;
  /** Whether this deck holds the pitch, and the switch for it — ../../docs/bpm.md. */
  keylock: boolean;
  onKeylock: () => void;
  /** Does PL8 hold a corrected tempo for this record, and the two gestures that write one? */
  corrected: boolean;
  /** …and its KEY as pl8 holds it, `C# minor` or "" — typed, never detected (../../docs/grid.md). */
  songKey: string;
  onHalve?: () => void;
  onDouble?: () => void;
  /** The record's middle was clicked — open the browser for this deck. */
  onPick: () => void;
  /** A playlist line was dropped on this deck, already read off the transfer — ../../docs/setList.md. */
  onDropSong: (drag: SongDrag) => void;
  /** The input gain in dB, at the HEAD of the strip — it reaches the record and its stems alike. */
  trim: number | undefined;
  trimLive: boolean;
  onTrim: (dB: number) => void;
  /** This deck's EQ knobs, in dB by band id, and whether they reach anything. */
  eq: Partial<Record<string, number>>;
  eqLive: boolean;
  onEq: (band: string, dB: number) => void;
  /** …and its filter, on the same strip but its own module. */
  filter: number | undefined;
  filterLive: boolean;
  onFilter: (value: number) => void;
  /** …and the one effect past it, 0..1. Unwired draws no knob rather than a dead one. */
  echo: number | undefined;
  echoLive: boolean;
  onEcho: (wet: number) => void;
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
  onCueSet: (slot: number, sourceSeconds: number) => void;
  /** The loop section: what is running on this deck, and the six gestures that drive it — docs/loop.md. */
  loop: LoopProps;
  /** …and where it is, in source seconds, for the waveform to draw a band over. */
  loopSpan: { start: number; end: number } | null;
  /** Push this deck's record by `seconds`, signed — the waveform's drag and the nudge buttons both. */
  onShove: (seconds: number) => void;
  /** Where this deck's needle is in its RECORD — its platter's clock, or the transport through the stretch. */
  needle: () => number;
  /** Is THIS deck turning? On a platter that is its own answer, not the transport's. */
  running: boolean;
  /** Start or stop it alone — absent on a separated deck, which has no platter to start. */
  onToggleDeck?: () => void;
  /** Drive the record by hand — absent for the same reason: a clip cannot be scratched. */
  onScratch?: (rate: number | null) => void;
  /** …and the sentence the record itself carries when it will not turn. */
  scratchRefusal?: string;
}) {
  const fader = (
    // The tempo column, with THIS deck's transport at the foot of it — under KEY, docs/mix.md.
    <div className="flex h-full w-14 shrink-0 flex-col items-center gap-1">
      <BpmFader
        natural={tempo?.natural ?? 0}
        target={tempo?.target ?? 0}
        driven={driven}
        onChange={onNudge}
        onCommit={onCommit}
        keylock={keylock}
        onKeylock={onKeylock}
        corrected={corrected}
        songKey={songKey}
        onHalve={onHalve}
        onDouble={onDouble}
      />
      {/* Always drawn, greyed when the deck is empty — the rule `CueButtons` states, docs/cues.md. */}
      <DeckPlay side={side} running={running} onToggle={onToggleDeck} />
    </div>
  );

  const strip = (
    <ChannelStrip
      trim={trim}
      trimLive={trimLive}
      eq={eq}
      eqLive={eqLive}
      filter={filter}
      filterLive={filterLive}
      echo={echo}
      echoLive={echoLive}
      // The same measurement the column beside it uses — the strip has the same height to fit in.
      layout={layout.strip}
      onTrim={onTrim}
      onEq={onEq}
      onFilter={onFilter}
      onEcho={onEcho}
    />
  );

  const [over, setOver] = useState(false);
  return (
    // The WHOLE deck takes the drop, knobs included: aiming at the record's label is a gesture for a mouse at rest.
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop has no keyboard form; the vinyl's button is the one that has.
    <section
      className={`flex min-w-0 flex-1 gap-2 rounded-lg ${over ? "outline outline-2 outline-primary/70" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(SONG_DRAG_TYPE)) return;
        // Both, and in this order: without preventDefault the browser refuses the drop without a word.
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(e) => {
        // Only when the pointer LEFT the deck — a child's boundary fires this too.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setOver(false);
      }}
      onDrop={(e) => {
        setOver(false);
        const drag = parseSongDrag(e.dataTransfer.getData(SONG_DRAG_TYPE));
        if (!drag) return;
        e.preventDefault();
        onDropSong(drag);
      }}
    >
      {/* Tempo on the OUTER edge and shaping on the INNER one, so the desk reads as a mirror. */}
      {side === "A" ? fader : strip}
      <div className="flex min-w-0 flex-1 flex-col items-center gap-3">
        {/* The STEMS beside the record and to its LEFT, above the waveform — ../../docs/stems.md. */}
        <div className="flex shrink-0 items-center justify-center gap-2">
          <StemStrip
            stems={stems}
            live={stemLive}
            ready={stemsReady}
            prep={stemPrep}
            layout={layout.strip}
            onStem={onStem}
          />
          {/* The record, only when the deck is tall enough to be worth one — ../../docs/deskLayout.md. */}
          {layout.vinyl > 0 ? (
            <Vinyl
              side={side}
              artist={load?.artist ?? null}
              title={load?.title ?? null}
              spinning={spinning && !!load}
              // How fast the FILE is playing: a record stretched to another tempo turns at that speed.
              ratio={
                tempo && tempo.natural > 0 && tempo.target > 0
                  ? tempo.natural / tempo.target
                  : 1
              }
              onPick={onPick}
              // The deck's own needle — a platter's clock, or the transport through the stretch.
              at={needle}
              length={tempo?.seconds ?? 0}
              markers={cues}
              size={layout.vinyl}
              onScratch={onScratch}
            />
          ) : null}
        </div>
        {/* Under the record, and ALWAYS drawn even with nothing loaded — ../../docs/deskLayout.md. */}
        <Waveform
          envelope={wave?.k === "ready" ? wave.env : null}
          // The same clock the record above reads — one needle per deck, whichever way it plays.
          needle={needle}
          loop={loopSpan}
          tempo={tempo}
          analysing={wave?.k === "loading"}
          problem={wave?.k === "none" ? wave.why : null}
          height={layout.waveform}
          // Draggable only with a record on and a tempo measured: `place` needs a ratio to convert by.
          onShove={load && tempo ? onShove : undefined}
        />
        {/* Edge to edge, nothing flanking them: eight cues are eight targets, and a target wants width. */}
        <CueButtons
          markers={cues}
          onJump={onCueJump}
          onSet={onCueSet}
          // The deck's OWN needle, read on the way down: no deck follows the transport any more.
          now={needle}
          disabled={!load}
        />
        {/* Under them, and greyed the same way: a loop is a length in BEATS, so it wants a grid. */}
        <LoopRow
          beats={loop.beats}
          rolling={loop.rolling}
          pending={loop.pending}
          step={loop.step}
          disabled={!load || !loop.can}
          onJump={loop.onJump}
          onIn={loop.onIn}
          onOut={loop.onOut}
          onLength={loop.onLength}
          onResize={loop.onResize}
          onRoll={loop.onRoll}
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
