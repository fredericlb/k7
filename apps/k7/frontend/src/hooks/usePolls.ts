// usePolls.ts — the shell's background polls, one hook each: the project
// errors, the waveform prewarm, and the follow of a project switch made under us. Apart from App.tsx so each cadence is one readable hook.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { isAnswer } from "../readFailure";
import { keepIfEqual, keepIfSame } from "../shellEquality";
import type {
  Diagnostic,
  EngineSyncState,
  FormatTooNew,
  WaveformStatus,
  WorkspaceInfo,
} from "../types";
import { pollWhileVisible } from "../visiblePoll";
import { useRevision } from "./useRevision";

/** The project's errors, gated on the change token rather than a timer — `/project-errors` compiles the project, `/revision` is a 2 ms file walk. */
export function useProjectErrors(reloadKey: number): {
  projectErrors: number;
  diagnostics: Diagnostic[];
  formatTooNew: FormatTooNew | null;
} {
  const [projectErrors, setErrorCount] = useState(0);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [formatTooNew, setFormatTooNew] = useState<FormatTooNew | null>(null);
  const rev = useRevision();
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is a TRIGGER, not a value this body reads — an action can change the answer without changing a source, and dropping it would stop noticing that.
  useEffect(() => {
    if (rev === null) return; // no token read yet — nothing has changed that we know of
    let alive = true;
    api
      .projectErrors()
      .then((r) => {
        if (!alive) return;
        setErrorCount(r.errors.length);
        setFormatTooNew(r.formatTooNew ?? null);
        // Every revision answers a fresh array, and the editor's gutter re-lints on a new one; the same findings keep the old.
        setDiagnostics(keepIfSame(r.diagnostics));
      })
      // A blip keeps the last count: zero would tell someone a broken project is fine.
      .catch((e) => {
        if (!alive || !isAnswer(e)) return;
        setErrorCount(0);
        setFormatTooNew(null);
        setDiagnostics(keepIfSame<Diagnostic[]>([]));
      });
    return () => {
      alive = false;
    };
  }, [rev, reloadKey]);
  return { projectErrors, diagnostics, formatTooNew };
}

/** Waveforms are cached and prewarmed on the backend; this kicks it, and steps aside for the transport — the decode competes for the same cores. */
export function useWarmWaveforms(
  reloadKey: number,
  playing: boolean,
): WaveformStatus {
  const [warm, setWarm] = useState<WaveformStatus>({
    warming: false,
    done: 0,
    total: 0,
  });
  const warmingRef = useRef(false);
  // Off once the shell unmounts: the loop outlives the effect that started it, and must not set state on a dead hook.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  // Every 350 ms the same answer comes back while nothing decodes; only a new count re-renders the shell.
  const show = useCallback((st: WaveformStatus) => {
    if (aliveRef.current) setWarm(keepIfEqual(st));
  }, []);
  const warmWaveforms = useCallback(async () => {
    await api
      .prewarmWaveforms()
      .then(show)
      .catch(() => {});
    if (warmingRef.current) return;
    warmingRef.current = true;
    try {
      while (aliveRef.current) {
        const st = await api.waveformStatus().catch(() => null);
        if (!st) break;
        show(st);
        if (!st.warming) break;
        await new Promise((r) => setTimeout(r, 350));
      }
    } finally {
      warmingRef.current = false;
    }
  }, [show]);
  useEffect(() => {
    if (playing) return; // the machine is busy making sound; ask again when it stops
    void warmWaveforms();
  }, [reloadKey, warmWaveforms, playing]);
  // Kill the batch on the transport's edge; the polling loop ends on its own, a cancelled prewarm reporting `warming: false`.
  useEffect(() => {
    if (!playing) return;
    void api.cancelWaveformPrewarm().catch(() => {});
  }, [playing]);
  return warm;
}

/** Follow what happens to the workspace under us: a project SWITCH, and a TAKE landing — the one edit nobody types, so no command reply mentions it. */
export function useActiveProjectFollow(opts: {
  lastActiveRef: React.RefObject<string | null>;
  onSwitch: (w: WorkspaceInfo) => void;
  /** A take was recorded: the workspace now names a clip this tab has never seen. */
  onTake?: (w: WorkspaceInfo) => void;
  /** Every answer's copy to the engine's machine, null when none is running or failed — docs engineSync.md. */
  onSync?: (s: EngineSyncState | null) => void;
  /** A take just stopped and has not landed yet: poll at TAKE_POLL_MS rather than every 2 s. */
  awaitingTake?: boolean;
}): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  // undefined == no answer read yet; null == read, and there was no take — a ref, as it outlives the interval's re-creation.
  const seen = useRef<string | null | undefined>(undefined);
  const eager = !!opts.awaitingTake;
  // One read at a time: at 200 ms a slow answer would overlap the next, and the older could land last, firing a take twice.
  const inFlight = useRef(false);
  // The sync state last handed on, as text: the same state every tick must not re-render the shell every tick.
  const lastSync = useRef<string | undefined>(undefined);
  useEffect(() => {
    const tick = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const w = await api.workspace();
        if (w.activeProject !== optsRef.current.lastActiveRef.current) {
          optsRef.current.lastActiveRef.current = w.activeProject;
          optsRef.current.onSwitch(w);
        }
        const clip = w.lastTake?.clip ?? null;
        const landed = isNewTake(seen.current, clip);
        seen.current = clip;
        if (landed) optsRef.current.onTake?.(w);
        const sync = JSON.stringify(w.engineSync ?? null);
        if (sync !== lastSync.current) {
          lastSync.current = sync;
          optsRef.current.onSync?.(w.engineSync ?? null);
        }
      } catch {
        /* backend momentarily unavailable */
      } finally {
        inFlight.current = false;
      }
    };
    return pollWhileVisible(tick, eager ? TAKE_POLL_MS : 2000);
  }, [eager]);
}

/** How often /workspace is read while a stopped take is on its way — the gap between Stop and its picture. */
const TAKE_POLL_MS = 200;

/** Is `clip` a take this tab has not seen? Seeding on the first answer is what makes this mean 'a take just landed' rather than 'a take exists'. */
export const isNewTake = (
  seen: string | null | undefined,
  clip: string | null,
): boolean => seen !== undefined && clip !== null && clip !== seen;
