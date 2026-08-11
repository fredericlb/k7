// usePolls.ts — the shell's background polls, one hook each: the git badge, the strudel
// lanes, the project errors, the waveform prewarm, and the follow of a project switch
// made under us. Extracted from App.tsx; cadences and behaviour unchanged.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type {
  Diagnostic,
  GitStatus,
  WaveformStatus,
  WebTrack,
  WorkspaceInfo,
} from "../types";
import { useRevision } from "./useRevision";

/**
 * The repo's ahead/behind for the share badge. A network op on the server (it fetches),
 * so it's called sparingly: on a 10-minute timer and right after a commit/pull
 * (refresh). Failures leave the last-known badge rather than clearing it.
 */
export function useGitStatus(): {
  gitStatus: GitStatus | null;
  refreshGitStatus: () => void;
} {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const refreshGitStatus = useCallback(() => {
    void api
      .gitStatus()
      .then(setGitStatus)
      .catch(() => {});
  }, []);
  useEffect(() => {
    refreshGitStatus();
    const id = setInterval(refreshGitStatus, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [refreshGitStatus]);
  return { gitStatus, refreshGitStatus };
}

/**
 * Whether two answers from the pattern clock say the same thing.
 *
 * By serialisation rather than a field-by-field compare, on purpose: `WebTrack` is a wide shape
 * that grows, and a hand-rolled equality would quietly stop noticing whatever was added last.
 * A few generated lanes stringified once every 700 ms is nothing beside the render it prevents.
 */
const sameTracks = (a: WebTrack[], b: WebTrack[]): boolean =>
  a.length === b.length && JSON.stringify(a) === JSON.stringify(b);

/**
 * The pattern clock's live lanes — polled only in a song that HAS a strudel track.
 * Without one the clock can never produce a lane, so the poll would ask for an empty
 * list forever. Clearing on the way out matters: a project switch from a strudel song
 * to a plain one would otherwise strand the old song's lanes on the timeline.
 */
export function useOrbit(hasStrudel: boolean): WebTrack[] {
  const [orbit, setOrbit] = useState<WebTrack[]>([]);
  useEffect(() => {
    if (!hasStrudel) {
      setOrbit([]);
      return;
    }
    let alive = true;
    // Only when they actually CHANGED. This lands a fresh array 1.4 times a second, and the
    // timeline derives its whole row list from it — so an unchanged answer used to rebuild
    // every lane and every clip, playing or not.
    const tick = () =>
      api
        .strudelTracks()
        .then((t) => {
          if (!alive) return;
          setOrbit((prev) => (sameTracks(prev, t) ? prev : t));
        })
        .catch(() => {});
    void tick();
    const id = setInterval(tick, 700);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [hasStrudel]);
  return orbit;
}

/**
 * The project's errors — the count for the status badge, and the located diagnostics
 * for the editor's inline squiggles.
 *
 * Gated on the change token rather than run on a timer: /project-errors compiles the
 * project, and this used to pay it every 2 seconds whether or not a file had moved.
 * /revision is a file walk (~2ms) that answers "has anything changed" — so the check
 * runs once per edit instead of thirty times a minute while you read. `reloadKey`
 * still forces a pass: an action can change the answer without changing a source.
 *
 * The token itself is polled once for the whole app (`useRevision`), not once per consumer.
 */
export function useProjectErrors(reloadKey: number): {
  projectErrors: number;
  diagnostics: Diagnostic[];
} {
  const [projectErrors, setErrorCount] = useState(0);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
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
        setDiagnostics(r.diagnostics);
      })
      .catch(() => {
        if (!alive) return;
        setErrorCount(0);
        setDiagnostics([]);
      });
    return () => {
      alive = false;
    };
  }, [rev, reloadKey]);
  return { projectErrors, diagnostics };
}

/**
 * Waveforms are cached + prewarmed on the backend; this kicks it and tracks progress.
 *
 * It steps aside for the transport. The batch runs a SECOND engine process to decode every
 * stale source, on the same machine as the engine that is playing, and the two competing for
 * cores is what made the playhead stutter through the first playback of a session — the only
 * one that pays, since the sidecars are cached after it. So: never start while playing, and
 * cancel an in-flight batch the moment the transport does. Whatever was already written stays
 * written, so stopping and resuming costs only the file that was mid-decode.
 */
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
  const warmWaveforms = useCallback(async () => {
    await api
      .prewarmWaveforms()
      .then(setWarm)
      .catch(() => {});
    if (warmingRef.current) return;
    warmingRef.current = true;
    try {
      for (;;) {
        const st = await api.waveformStatus().catch(() => null);
        if (!st) break;
        setWarm(st);
        if (!st.warming) break;
        await new Promise((r) => setTimeout(r, 350));
      }
    } finally {
      warmingRef.current = false;
    }
  }, []);
  useEffect(() => {
    if (playing) return; // the machine is busy making sound; ask again when it stops
    void warmWaveforms();
  }, [reloadKey, warmWaveforms, playing]);
  // Kill the batch on the transport's edge. The polling loop above ends on its own: a cancelled
  // prewarm reports `warming: false`, which is exactly what the loop waits for.
  useEffect(() => {
    if (!playing) return;
    void api.cancelWaveformPrewarm().catch(() => {});
  }, [playing]);
  return warm;
}

/**
 * Follow a project switch made under us (another tab, the CLI): when the workspace's
 * active project changes, refresh the workspace + project state and bump the reload.
 * `lastActiveRef` is shared with the shell so its own opens don't read as a switch.
 */
export function useActiveProjectFollow(opts: {
  lastActiveRef: React.RefObject<string | null>;
  onSwitch: (w: WorkspaceInfo) => void;
}): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const w = await api.workspace();
        if (w.activeProject !== optsRef.current.lastActiveRef.current) {
          optsRef.current.lastActiveRef.current = w.activeProject;
          optsRef.current.onSwitch(w);
        }
      } catch {
        /* backend momentarily unavailable */
      }
    }, 2000);
    return () => clearInterval(id);
  }, []);
}
