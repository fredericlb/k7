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
    const tick = () =>
      api
        .strudelTracks()
        .then((t) => alive && setOrbit(t))
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
 */
export function useProjectErrors(reloadKey: number): {
  projectErrors: number;
  diagnostics: Diagnostic[];
} {
  const [projectErrors, setErrorCount] = useState(0);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  useEffect(() => {
    let alive = true;
    let seen: string | null = null;
    const fetchErrors = () =>
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
    const tick = async () => {
      try {
        const { rev } = await api.revision();
        if (!alive || rev === seen) return;
        seen = rev;
      } catch {
        return; // file service unreachable — keep what we have, retry next tick
      }
      await fetchErrors();
    };
    void tick();
    const id = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [reloadKey]);
  return { projectErrors, diagnostics };
}

/** Waveforms are cached + prewarmed on the backend; this kicks it and tracks progress. */
export function useWarmWaveforms(reloadKey: number): WaveformStatus {
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
    void warmWaveforms();
  }, [reloadKey, warmWaveforms]);
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
