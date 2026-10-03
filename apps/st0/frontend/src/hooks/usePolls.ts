// usePolls.ts — the shell's background polls, one hook each: the git badge, the project
// errors, the waveform prewarm, and the follow of a project switch made under us. Apart from App.tsx so each cadence is one readable hook.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type {
  Diagnostic,
  EngineSyncState,
  GitStatus,
  WaveformStatus,
  WorkspaceInfo,
} from "../types";
import { useRevision } from "./useRevision";

/** The repo's ahead/behind for the share badge — a network op on the server, so it runs on a 10-minute timer and after a commit or pull. */
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

/** The project's errors, gated on the change token rather than a timer — `/project-errors` compiles the project, `/revision` is a 2 ms file walk. */
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
}): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  useEffect(() => {
    // undefined == no answer read yet; null == read, and there was no take.
    let seen: string | null | undefined;
    const id = setInterval(async () => {
      try {
        const w = await api.workspace();
        if (w.activeProject !== optsRef.current.lastActiveRef.current) {
          optsRef.current.lastActiveRef.current = w.activeProject;
          optsRef.current.onSwitch(w);
        }
        const clip = w.lastTake?.clip ?? null;
        const landed = isNewTake(seen, clip);
        seen = clip;
        if (landed) optsRef.current.onTake?.(w);
        optsRef.current.onSync?.(w.engineSync ?? null);
      } catch {
        /* backend momentarily unavailable */
      }
    }, 2000);
    return () => clearInterval(id);
  }, []);
}

/** Is `clip` a take this tab has not seen? Seeding on the first answer is what makes this mean 'a take just landed' rather than 'a take exists'. */
export const isNewTake = (
  seen: string | null | undefined,
  clip: string | null,
): boolean => seen !== undefined && clip !== null && clip !== seen;
