import { Button } from "@frediverse/ui/button";
import { Card, CardContent } from "@frediverse/ui/card";
import {
  ArrowRight,
  Check,
  Loader2,
  Music2,
  Plus,
  RotateCcw,
  X as XIcon,
} from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { type Player, usePlayerState } from "@studio/player-web";
import { SongPreloader } from "@studio/player-web/preloader";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { f } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  altDisplay,
  alternativesFor,
  artistVariants,
  buildSlots,
  normalize,
  type Session,
  type SoloResume,
  type Song,
  songArtistTitle,
  songScoreAt,
  type Track,
  withinOneEdit,
} from "../lib/game";
import {
  hasGuestPlayedSession,
  markGuestPlayedSession,
  type PlayedKind,
} from "../lib/guest";
import { m } from "../paraglide/messages.js";
import {
  BlockedCard,
  CategoryJump,
  EndCard,
  Hud,
  IntroCard,
  LastAnswer,
  type LeaderboardEntry,
} from "./SoloPanels";
import { Tip } from "./Tip";

// The walker, on a mutable ref so async flows never read stale state; engine and scoring inject.

type VerdictKind =
  | "correct"
  | "wrong"
  | "timeout"
  | "skip"
  | "retry"
  | "half"
  | "track";
interface VerdictFlash {
  kind: VerdictKind;
  detail?: string;
  delta: number;
}

const MAX_ATTEMPTS = 3;
const WRONG_ATTEMPT_PENALTY = 100;
const TIMER_DURATION_MS = 60_000;

/** Where the score lives; `progress: false` for a playlist run, which has no table and is short. */
export interface ScoringTarget {
  base: string;
  progress: boolean;
  /** Namespaces the guest replay-block, since the two id spaces overlap. */
  kind: PlayedKind;
}

const SOLO_SCORING: ScoringTarget = {
  base: "/api/solo/sessions",
  progress: true,
  kind: "session",
};

export function SoloGame({
  session,
  sessionId,
  resume,
  onExit,
  onScored,
  makePlayer,
  scoring = SOLO_SCORING,
}: {
  session: Session;
  sessionId: number;
  resume?: SoloResume | null;
  onExit: () => void;
  onScored: (value: number) => void;
  /** Factory, not an instance — the engine is created once per mount. */
  makePlayer?: () => Player;
  scoring?: ScoringTarget;
}) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const preloaderRef = useRef<Player | null>(null);
  if (!preloaderRef.current)
    preloaderRef.current = makePlayer ? makePlayer() : new SongPreloader();
  const preloader = preloaderRef.current;
  const { loading, progress, isPlaying } = usePlayerState(preloader);
  const { user: authUser } = useAuth();
  const isGuest = authUser?.kind === "guest_online";

  const slots = useMemo(() => buildSlots(session), [session]);

  // Mutable game state, in one object; every mutation must be followed by render().
  const g = useRef({
    orderIndex: resume?.orderIndex ?? 0,
    songIndex: -1,
    phase: "intro" as "intro" | "playing" | "end",
    score: resume?.score ?? 0,
    pendingResumeSongIndex:
      resume && resume.songIndex >= 0 ? resume.songIndex : -1,
    guess: "",
    guessHistory: [] as string[],
    historyCursor: -1,
    attemptsRemaining: MAX_ATTEMPTS,
    artistClaimed: false,
    titleClaimed: false,
    claimedPairIdx: null as number | null,
    claimedMultiTracks: new Set<number>(),
    verdictFlash: null as VerdictFlash | null,
    flashCounter: 0,
    timerRemainingMs: TIMER_DURATION_MS,
    awaitingNextSong: false,
    previousSong: null as Song | null,
    showCategoryJump: false,
    leaderboard: null as LeaderboardEntry[] | null,
    alreadyPlayedAsGuest: false,
    scoreSent: false,
  }).current;
  const render = force as () => void;

  // Non-render bookkeeping.
  const nr = useRef({
    preloadPromiseByIndex: new Map<number, Promise<void>>(),
    readyByIndex: new Map<number, boolean>(),
    fusionTimers: [] as number[],
    timerInterval: null as number | null,
    timerEndsAt: 0,
    songStartTs: 0,
    verdictTimer: null as number | null,
    lastSPress: 0,
    masterGain: 0.8,
  }).current;

  const inputRef = useRef<HTMLInputElement | null>(null);

  const currentSlot = slots[g.orderIndex] ?? null;
  const currentSong: Song | null =
    currentSlot && g.songIndex >= 0
      ? (currentSlot.songs[g.songIndex] ?? null)
      : null;
  const currentMode = currentSlot?.category?.mode || "";

  // ── helpers ────────────────────────────────────────────────────────────

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);

  function clearFusionTimers() {
    for (const id of nr.fusionTimers) clearTimeout(id);
    nr.fusionTimers = [];
  }

  function clearTimer() {
    if (nr.timerInterval !== null) {
      clearInterval(nr.timerInterval);
      nr.timerInterval = null;
    }
  }

  function startTimer() {
    clearTimer();
    nr.timerEndsAt = performance.now() + TIMER_DURATION_MS;
    nr.songStartTs = performance.now();
    g.timerRemainingMs = TIMER_DURATION_MS;
    nr.timerInterval = window.setInterval(() => {
      const remain = nr.timerEndsAt - performance.now();
      if (remain <= 0) {
        g.timerRemainingMs = 0;
        clearTimer();
        render();
        onTimerExpired();
        return;
      }
      g.timerRemainingMs = remain;
      render();
    }, 100);
  }

  function onTimerExpired() {
    if (g.phase !== "playing" || !currentSongOf()) return;
    showVerdict("timeout", currentSongOf()!);
    void next();
  }

  function currentSongOf(): Song | null {
    const s = slots[g.orderIndex];
    if (!s || g.songIndex < 0) return null;
    return s.songs[g.songIndex] ?? null;
  }

  function clearVerdictTimer() {
    if (nr.verdictTimer !== null) {
      clearTimeout(nr.verdictTimer);
      nr.verdictTimer = null;
    }
  }

  function flash(v: VerdictFlash, ms: number) {
    clearVerdictTimer();
    g.verdictFlash = v;
    g.flashCounter++;
    render();
    nr.verdictTimer = window.setTimeout(() => {
      g.verdictFlash = null;
      nr.verdictTimer = null;
      render();
    }, ms);
  }

  function showVerdict(kind: VerdictKind, song: Song, delta = 0) {
    let detail: string | undefined;
    if (kind === "correct") {
      const { artist, title } = songArtistTitle(song);
      detail = `${artist} ${title}`.trim() || undefined;
    }
    g.previousSong = song; // "last answer" footer — only song-final outcomes land here
    flash({ kind, detail, delta }, kind === "correct" ? 2500 : 1500);
  }

  function currentSongScore(): number {
    return songScoreAt((performance.now() - nr.songStartTs) / 1000);
  }

  // ── playback ───────────────────────────────────────────────────────────

  function startFusionAlternating(tracks: Track[]) {
    clearFusionTimers();
    if (tracks.length < 2 || !tracks[0].path || !tracks[1].path) return;
    void preloader.playDual(
      tracks[0].path,
      tracks[1].path,
      tracks[0].from ?? 0,
      tracks[0].to ?? 0,
      tracks[1].from ?? 0,
    );
    preloader.setGain(nr.masterGain);
    preloader.setSecondGain(0);
    let on1 = true;
    const tick = () => {
      on1 = !on1;
      preloader.setGain(on1 ? nr.masterGain : 0);
      preloader.setSecondGain(on1 ? 0 : nr.masterGain);
      nr.fusionTimers.push(window.setTimeout(tick, 4000));
    };
    nr.fusionTimers.push(window.setTimeout(tick, 4000));
  }

  function schedulePreload(idx: number) {
    const s = slots[g.orderIndex];
    if (!s || s.kind !== "category") return;
    if (idx < 0 || idx >= s.songs.length) return;
    if (nr.preloadPromiseByIndex.has(idx)) return;
    const p = preloader.preloadSong(s.songs[idx]).then(() => {
      nr.readyByIndex.set(idx, true);
    });
    nr.preloadPromiseByIndex.set(idx, p);
  }

  function resetPreloadState() {
    nr.preloadPromiseByIndex.clear();
    nr.readyByIndex.clear();
    g.awaitingNextSong = false;
    preloader.unload();
  }

  async function playCurrentSong() {
    const song = currentSongOf();
    if (!song) return;
    // Progressive load: fetch i+1 while i plays.
    schedulePreload(g.songIndex + 1);
    const mode = slots[g.orderIndex]?.category?.mode || "";
    const from = song.from ?? 0;
    const to = song.to ?? 0;
    clearFusionTimers();
    preloader.setEffects(song.effects ?? {});
    preloader.setGain(nr.masterGain);

    if (mode === "free") return;
    if (mode === "multi") {
      const tracks = (song.tracks ?? [])
        .filter((tr): tr is Track & { path: string } => !!tr.path)
        .map((tr) => ({ path: tr.path, from: tr.from ?? from }));
      if (tracks.length) await preloader.playMulti(tracks);
      return;
    }
    if (mode === "reversed") {
      if (song.path) await preloader.playReversed(song.path, from, to);
      return;
    }
    if (mode === "fusion") {
      const tracks = song.tracks ?? [];
      if (tracks.length >= 2) startFusionAlternating(tracks);
      else if (tracks.length === 1 && tracks[0].path) {
        await preloader.play(
          tracks[0].path,
          tracks[0].from ?? from,
          tracks[0].to ?? to,
        );
      }
      return;
    }
    if (song.path) await preloader.play(song.path, from, to);
  }

  // ── walker ─────────────────────────────────────────────────────────────

  async function postProgress() {
    if (!sessionId || g.phase === "end" || !scoring.progress) return;
    try {
      await f(`${scoring.base}/${sessionId}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIndex: g.orderIndex,
          songIndex: Math.max(0, g.songIndex),
          score: g.score,
          played: playedSoFar(),
          total: totalSongs,
        }),
      });
    } catch {
      /* fire-and-forget */
    }
  }

  async function startSlot() {
    preloader.resumeContext(); // must run synchronously in the click gesture
    const s = slots[g.orderIndex];
    if (!s) return;
    let startAt = 0;
    if (g.pendingResumeSongIndex >= 0) {
      startAt = Math.min(g.pendingResumeSongIndex, s.songs.length - 1);
      g.pendingResumeSongIndex = -1;
    }
    g.songIndex = startAt;
    g.attemptsRemaining = MAX_ATTEMPTS;
    g.artistClaimed = false;
    g.titleClaimed = false;
    g.claimedPairIdx = null;
    g.claimedMultiTracks = new Set();
    g.phase = "playing";
    render();
    startTimer();
    focusInput();
    await playCurrentSong();
    void postProgress();
  }

  function resetPerSongState() {
    g.guess = "";
    g.attemptsRemaining = MAX_ATTEMPTS;
    g.artistClaimed = false;
    g.titleClaimed = false;
    g.claimedPairIdx = null;
    g.claimedMultiTracks = new Set();
  }

  async function next() {
    clearFusionTimers();
    preloader.stop();
    clearTimer();
    resetPerSongState();
    const s = slots[g.orderIndex];
    if (!s) return;
    if (g.songIndex + 1 < s.songs.length) {
      const nextIdx = g.songIndex + 1;
      schedulePreload(nextIdx);
      if (!nr.readyByIndex.get(nextIdx)) {
        g.awaitingNextSong = true;
        render();
        try {
          await nr.preloadPromiseByIndex.get(nextIdx);
        } finally {
          g.awaitingNextSong = false;
        }
        if (slots[g.orderIndex] !== s) {
          render();
          return;
        }
      }
      g.songIndex = nextIdx;
      g.phase = "playing";
      render();
      startTimer();
      focusInput();
      void playCurrentSong();
      void postProgress();
    } else {
      advanceSlot();
    }
  }

  function advanceSlot() {
    clearFusionTimers();
    preloader.stop();
    clearTimer();
    g.orderIndex += 1;
    g.songIndex = -1;
    if (g.orderIndex >= slots.length) {
      g.phase = "end";
    } else {
      g.phase = "intro";
      void postProgress();
    }
    render();
  }

  function restart() {
    clearFusionTimers();
    preloader.stop();
    clearTimer();
    clearVerdictTimer();
    g.verdictFlash = null;
    g.orderIndex = 0;
    g.songIndex = -1;
    g.score = 0;
    g.pendingResumeSongIndex = -1;
    g.guessHistory = [];
    g.historyCursor = -1;
    g.previousSong = null;
    resetPerSongState();
    g.phase = "intro";
    render();
  }

  function jumpToSlot(idx: number) {
    if (idx < 0 || idx >= slots.length) return;
    g.showCategoryJump = false;
    if (idx === g.orderIndex && g.phase === "playing") {
      render();
      return;
    }
    clearFusionTimers();
    preloader.stop();
    clearTimer();
    clearVerdictTimer();
    g.verdictFlash = null;
    g.pendingResumeSongIndex = -1;
    g.orderIndex = idx;
    g.songIndex = -1;
    g.guessHistory = [];
    g.historyCursor = -1;
    resetPerSongState();
    g.phase = "intro";
    render();
    void postProgress();
  }

  // ── answers ────────────────────────────────────────────────────────────

  const multiTracks: Track[] =
    currentMode === "multi"
      ? (currentSong?.tracks ?? []).filter((tr) => tr.path)
      : [];

  function burnAttempt(song: Song) {
    g.score -= WRONG_ATTEMPT_PENALTY;
    g.attemptsRemaining -= 1;
    if (g.attemptsRemaining <= 0) {
      showVerdict("wrong", song, -WRONG_ATTEMPT_PENALTY);
      void next();
      return;
    }
    g.guess = "";
    flash(
      {
        kind: "retry",
        detail: `−${WRONG_ATTEMPT_PENALTY} · ${g.attemptsRemaining} attempt${g.attemptsRemaining === 1 ? "" : "s"} left`,
        delta: -WRONG_ATTEMPT_PENALTY,
      },
      1200,
    );
    focusInput();
  }

  function matchMultiTrack(song: Song, n: string): boolean {
    if (!multiTracks.length) return false;
    for (let i = 0; i < multiTracks.length; i++) {
      if (g.claimedMultiTracks.has(i)) continue;
      const track = multiTracks[i];
      const artist = (track.artist ?? "").trim();
      const title = (track.title ?? "").trim();
      if (!artist && !title) continue;
      const aVars = artistVariants(artist);
      const nTitle = normalize(title);
      const matches =
        aVars.some((a) => withinOneEdit(n, a)) ||
        (!!nTitle && withinOneEdit(n, nTitle)) ||
        (!!nTitle && aVars.some((a) => withinOneEdit(n, a + nTitle)));
      if (!matches) continue;

      const earned = currentSongScore() / 2;
      g.score += earned;
      g.claimedMultiTracks = new Set([...g.claimedMultiTracks, i]);
      preloader.muteMultiTrack(i);
      const remaining = multiTracks.length - g.claimedMultiTracks.size;
      if (remaining === 0) {
        showVerdict("correct", song, earned);
        void next();
      } else {
        flash(
          {
            kind: "track",
            detail:
              remaining === 1 ? "1 track left" : `${remaining} tracks left`,
            delta: earned,
          },
          1500,
        );
        g.guess = "";
        focusInput();
      }
      return true;
    }
    return false;
  }

  function submitGuess() {
    const song = currentSongOf();
    if (!song) return;
    const typed = g.guess;
    if (!typed.trim()) return;
    // history push
    const trimmed = typed.trim();
    if (g.guessHistory[0] !== trimmed) g.guessHistory.unshift(trimmed);
    g.historyCursor = -1;
    const n = normalize(typed);

    if (currentMode === "multi") {
      if (matchMultiTrack(song, n)) return;
      burnAttempt(song);
      return;
    }

    const alts = alternativesFor(song);
    if (alts.length === 0) {
      burnAttempt(song);
      return;
    }

    // 1) Full-match across alternatives (pair = "artist title" variants).
    for (let i = 0; i < alts.length; i++) {
      const alt = alts[i];
      const targets =
        alt.kind === "plain"
          ? [normalize(alt.text)].filter(Boolean)
          : artistVariants(alt.artist)
              .map((a) => a + normalize(alt.title))
              .filter(Boolean);
      if (!targets.some((tg) => withinOneEdit(n, tg))) continue;
      let earned = currentSongScore();
      if (
        g.claimedPairIdx !== null &&
        g.claimedPairIdx === i &&
        alt.kind === "pair"
      ) {
        const remaining = (g.artistClaimed ? 0 : 1) + (g.titleClaimed ? 0 : 1);
        earned = (currentSongScore() * remaining) / 2;
      }
      g.score += earned;
      g.artistClaimed = true;
      g.titleClaimed = true;
      showVerdict("correct", song, earned);
      void next();
      return;
    }

    // 2) Half-match on pair alternatives (locked to the claimed pair if any).
    const candidatePairs: { alt: (typeof alts)[number]; idx: number }[] = [];
    if (g.claimedPairIdx !== null) {
      const locked = alts[g.claimedPairIdx];
      if (locked && locked.kind === "pair")
        candidatePairs.push({ alt: locked, idx: g.claimedPairIdx });
    } else {
      for (let i = 0; i < alts.length; i++) {
        if (alts[i].kind === "pair")
          candidatePairs.push({ alt: alts[i], idx: i });
      }
    }

    for (const { alt, idx } of candidatePairs) {
      if (alt.kind !== "pair") continue;
      const aVars = artistVariants(alt.artist);
      const nTitle = normalize(alt.title);
      const artistMatch =
        aVars.length > 0 &&
        !g.artistClaimed &&
        aVars.some((a) => withinOneEdit(n, a));
      const titleMatch =
        nTitle.length > 0 && !g.titleClaimed && withinOneEdit(n, nTitle);
      if (!artistMatch && !titleMatch) continue;

      const earned = currentSongScore() / 2;
      g.score += earned;
      if (artistMatch) g.artistClaimed = true;
      if (titleMatch) g.titleClaimed = true;
      if (g.claimedPairIdx === null) g.claimedPairIdx = idx;

      if (g.artistClaimed && g.titleClaimed) {
        showVerdict("correct", song, earned);
        void next();
        return;
      }
      flash(
        {
          kind: "half",
          detail: artistMatch
            ? "got the artist — now find the title"
            : "got the title — now find the artist",
          delta: earned,
        },
        1500,
      );
      g.guess = "";
      focusInput();
      return;
    }

    burnAttempt(song);
  }

  function skip() {
    const song = currentSongOf();
    if (!song) return;
    showVerdict("skip", song);
    void next();
  }

  function navigateHistory(direction: 1 | -1) {
    const hist = g.guessHistory;
    if (hist.length === 0) return;
    const nxt = g.historyCursor + direction;
    if (nxt < -1 || nxt >= hist.length) return;
    g.historyCursor = nxt;
    g.guess = nxt === -1 ? "" : hist[nxt];
    render();
  }

  // ── end-of-run: score save + leaderboard ───────────────────────────────

  async function persistFinalScore() {
    if (g.scoreSent) return;
    g.scoreSent = true;
    try {
      const r = await f(`${scoring.base}/${sessionId}/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score: g.score }),
      });
      if (!r.ok) {
        if (r.status !== 403)
          console.warn(`[solo] score save failed: ${r.status}`);
        return;
      }
      const data = (await r.json()) as { score: number };
      onScored(data.score);
    } catch (e) {
      console.warn("[solo] score save errored:", e);
    }
  }

  async function loadLeaderboard() {
    g.leaderboard = null;
    render();
    try {
      const r = await f(`${scoring.base}/${sessionId}/leaderboard`, {
        cache: "no-store",
      });
      const data = r.ok
        ? ((await r.json()) as { entries?: LeaderboardEntry[] })
        : {};
      g.leaderboard = Array.isArray(data.entries) ? data.entries : [];
    } catch {
      g.leaderboard = [];
    }
    render();
  }

  // ── effects ────────────────────────────────────────────────────────────

  // Intro-phase preload kick, on any change of phase or order index.
  const phaseKey = `${g.phase}:${g.orderIndex}`;
  useEffect(() => {
    if (g.phase !== "intro") return;
    const s = slots[g.orderIndex];
    if (!s || s.kind !== "category") return;
    resetPreloadState();
    schedulePreload(0);
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseKey, slots]);

  // End phase: stamp guest played-set, save score, fetch the board.
  useEffect(() => {
    if (g.phase !== "end") return;
    if (isGuest) markGuestPlayedSession(sessionId, scoring.kind);
    void persistFinalScore().then(() => void loadLeaderboard());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.phase === "end"]);

  // Guest replay block + its leaderboard.
  useEffect(() => {
    const blocked = isGuest && hasGuestPlayedSession(sessionId, scoring.kind);
    if (blocked !== g.alreadyPlayedAsGuest) {
      g.alreadyPlayedAsGuest = blocked;
      render();
      if (blocked) void loadLeaderboard();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, sessionId]);

  // Session prop swap → restart.
  const firstSession = useRef(session);
  useEffect(() => {
    if (firstSession.current !== session) {
      firstSession.current = session;
      restart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Out-of-bounds guard (stale resume past the filtered slots list).
  useEffect(() => {
    if (g.phase === "end") return;
    if (slots.length === 0 || g.orderIndex >= slots.length) {
      console.warn("[Solo] orderIndex past slots length — jumping to end");
      preloader.stop();
      clearTimer();
      g.orderIndex = slots.length;
      g.songIndex = -1;
      g.phase = "end";
      render();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, g.orderIndex, g.phase]);

  // "ss" hotkey → category jump; unmount cleanup.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "s" && e.key !== "S") return;
      if (e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return;
      if (g.phase === "end") return;
      const now = performance.now();
      if (now - nr.lastSPress < 500) {
        nr.lastSPress = 0;
        g.showCategoryJump = true;
        render();
      } else {
        nr.lastSPress = now;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearFusionTimers();
      clearTimer();
      clearVerdictTimer();
      preloader.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── derived ────────────────────────────────────────────────────────────

  const totalSongs = useMemo(
    () => slots.reduce((n, s) => n + s.songs.length, 0),
    [slots],
  );
  const playedSoFar = useCallback(() => {
    let n = 0;
    for (let i = 0; i < g.orderIndex && i < slots.length; i++)
      n += slots[i].songs.length;
    if (g.songIndex >= 0) n += g.songIndex;
    else if (g.pendingResumeSongIndex >= 0) n += g.pendingResumeSongIndex;
    return n;
  }, [slots, g]);

  const needsBothHalves = currentSong
    ? alternativesFor(currentSong).some((a) => a.kind === "pair")
    : false;

  const isExcerpt = (() => {
    const song = currentSong;
    if (!song) return false;
    if (["multi", "fusion", "reversed", "free"].includes(currentMode))
      return false;
    if (currentMode === "one") return true;
    const from = song.from ?? 0;
    const to = song.to ?? 0;
    return to > from && to - from <= 10;
  })();

  const previousAnswerText = (() => {
    const s = g.previousSong;
    if (!s) return "";
    const alts = alternativesFor(s);
    return alts.length ? altDisplay(alts[0]) : "";
  })();

  const verdictIconKind = (() => {
    switch (g.verdictFlash?.kind) {
      case "correct":
      case "track":
        return "ok";
      case "half":
        return "half";
      default:
        return g.verdictFlash ? "bad" : "";
    }
  })();
  // color-mix() over the shared tokens, so the palette stays in @frediverse/ui's theme.css.
  const VERDICT_STYLE: Record<
    string,
    { Icon: typeof Check; text: string; flash: string }
  > = {
    ok: {
      Icon: Check,
      text: "text-green",
      flash: "color-mix(in srgb, var(--color-green) 45%, transparent)",
    },
    half: {
      Icon: Plus,
      text: "text-amber",
      flash: "color-mix(in srgb, var(--color-amber) 50%, transparent)",
    },
    bad: {
      Icon: XIcon,
      text: "text-destructive",
      flash: "color-mix(in srgb, var(--color-destructive) 50%, transparent)",
    },
  };
  const verdictStyle = VERDICT_STYLE[verdictIconKind];
  const deltaLabel = (() => {
    const d = g.verdictFlash?.delta ?? 0;
    if (!d) return "";
    const r = Math.round(d);
    return r > 0 ? `+${r}` : `${r}`;
  })();

  const timerPercent = Math.max(
    0,
    Math.min(100, (g.timerRemainingMs / TIMER_DURATION_MS) * 100),
  );
  const timerColor =
    timerPercent < 10
      ? "bg-destructive"
      : timerPercent < 30
        ? "bg-amber"
        : "bg-green";

  // ── render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      <Hud
        score={g.score}
        played={playedSoFar()}
        total={totalSongs}
        canSkip={g.phase === "playing" && !!currentSong}
        onSkip={skip}
      />

      {g.phase === "end" ? (
        <EndCard
          score={g.score}
          leaderboard={g.leaderboard}
          showActions={!isGuest}
          onRestart={restart}
          onExit={onExit}
        />
      ) : g.alreadyPlayedAsGuest ? (
        <BlockedCard leaderboard={g.leaderboard} />
      ) : g.phase === "intro" && currentSlot?.kind === "category" ? (
        <IntroCard
          index={g.orderIndex}
          total={slots.length}
          slot={currentSlot}
          loading={loading}
          progress={progress}
          onStart={() => void startSlot()}
        />
      ) : g.phase === "playing" && currentSong ? (
        <Card className="relative overflow-hidden">
          {/* Bespoke bars, the attempts here and the timer below: commons has no progress component. */}
          <Tip
            label={m["solo.hud.attemptsLeftTitle"]({ n: g.attemptsRemaining })}
          >
            <div className="absolute inset-x-0 top-0 z-10 flex h-1 gap-0.5">
              {Array.from({ length: MAX_ATTEMPTS }, (_, i) => (
                <div
                  key={i}
                  className={`flex-1 transition-colors duration-200 ${
                    i + 1 > g.attemptsRemaining ? "bg-secondary" : "bg-amber"
                  }`}
                />
              ))}
            </div>
          </Tip>

          <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
            <div className="flex w-full flex-col items-center gap-4 sm:flex-row sm:justify-between">
              <div className="relative flex size-36 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-secondary">
                {g.verdictFlash && (
                  <span
                    key={g.flashCounter}
                    className="verdict-flash absolute inset-0"
                    style={
                      { "--flash-color": verdictStyle.flash } as CSSProperties
                    }
                  />
                )}
                {verdictStyle ? (
                  <span
                    key={verdictIconKind + g.flashCounter}
                    className={`relative flex flex-col items-center gap-1 font-bold ${verdictStyle.text}`}
                  >
                    <verdictStyle.Icon className="size-12" strokeWidth={2.5} />
                    {deltaLabel && (
                      <span className="text-lg tabular-nums">{deltaLabel}</span>
                    )}
                  </span>
                ) : g.awaitingNextSong ? (
                  <Loader2
                    className="relative size-10 animate-spin text-muted-foreground"
                    aria-label="loading"
                  />
                ) : isExcerpt ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="group relative size-full flex-col gap-1.5 rounded-none font-normal"
                    onClick={() => void playCurrentSong()}
                  >
                    <RotateCcw className="size-10 text-muted-foreground transition-colors group-hover:text-primary" />
                    <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground transition-colors group-hover:text-primary">
                      {m["solo.play.replay"]()}
                    </span>
                  </Button>
                ) : isPlaying ? (
                  <Music2 className="relative size-9 text-foreground" />
                ) : (
                  <span className="relative size-2 rounded-full bg-muted-foreground" />
                )}
              </div>

              {currentMode === "multi" && multiTracks.length ? (
                <ul className="flex min-w-0 flex-1 flex-col gap-1 self-stretch">
                  {multiTracks.map((track, i) => {
                    const found = g.claimedMultiTracks.has(i);
                    return (
                      <li
                        key={i}
                        className={[
                          "truncate rounded-md border px-2.5 py-1.5 text-left text-sm",
                          found
                            ? "border-green/50 bg-green/10 text-foreground"
                            : "border-border bg-card",
                        ].join(" ")}
                      >
                        {found ? (
                          <>
                            <span className="font-semibold text-green">
                              {track.artist || "—"}
                            </span>
                            <span className="mx-1.5 text-muted-foreground">
                              ·
                            </span>
                            <span>{track.title || "—"}</span>
                          </>
                        ) : (
                          <span className="tracking-[0.3em] text-muted-foreground/50">
                            ???
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : needsBothHalves ? (
                <div className="flex gap-6 text-xs uppercase tracking-[0.2em] sm:flex-col sm:items-end sm:gap-2">
                  <span
                    className={
                      g.artistClaimed
                        ? "text-muted-foreground line-through"
                        : "text-foreground"
                    }
                  >
                    {m["solo.play.artist"]()}
                  </span>
                  <span
                    className={
                      g.titleClaimed
                        ? "text-muted-foreground line-through"
                        : "text-foreground"
                    }
                  >
                    {m["solo.play.title"]()}
                  </span>
                </div>
              ) : null}
            </div>

            <form
              className="flex w-full max-w-lg gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                submitGuess();
              }}
            >
              <Input
                ref={inputRef}
                className="h-11 text-base"
                type="text"
                placeholder={m["solo.play.typeAnswer"]()}
                autoComplete="off"
                value={g.guess}
                onChange={(e) => {
                  g.guess = e.target.value;
                  g.historyCursor = -1;
                  render();
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    navigateHistory(1);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    navigateHistory(-1);
                  }
                }}
              />
              <Tip label={m["solo.play.submit"]()}>
                <Button
                  type="submit"
                  size="icon-lg"
                  disabled={!g.guess.trim()}
                  aria-label={m["solo.play.submit"]()}
                >
                  <ArrowRight className="size-5" />
                </Button>
              </Tip>
            </form>

            {currentSlot?.category?.notice && (
              <p className="max-w-md text-sm italic text-muted-foreground">
                {currentSlot.category.notice}
              </p>
            )}
            {currentSong?.notice && (
              <p className="max-w-md border-l-2 border-amber pl-2.5 text-left text-sm italic text-muted-foreground">
                {currentSong.notice}
              </p>
            )}
          </CardContent>

          <div className="fixed inset-x-0 top-0 z-50 h-[3px] bg-transparent">
            <div
              className={`h-full transition-[width] duration-100 ease-linear ${timerColor}`}
              style={{ width: `${timerPercent}%` }}
            />
          </div>
        </Card>
      ) : null}

      {previousAnswerText && g.phase !== "end" && (
        <LastAnswer text={previousAnswerText} />
      )}

      <CategoryJump
        open={g.showCategoryJump}
        onClose={() => {
          g.showCategoryJump = false;
          render();
        }}
        slots={slots}
        current={g.orderIndex}
        onJump={jumpToSlot}
      />
    </div>
  );
}
