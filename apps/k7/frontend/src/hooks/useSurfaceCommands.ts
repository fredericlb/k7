// useSurfaceCommands.ts — running a command from a screen that is NOT the shell: an external
// surface has no command bar, no undo journal and no chains pane, so the three things App's
// `runCommand` exists to feed are all absent. What is left is the write, the reload it implies
// and one line to say what happened. See ../../docs/external.md.

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { m } from "../paraglide/messages.js";
import { useLatest } from "./useLatest";
import { useRevision } from "./useRevision";

export interface SurfaceCommands {
  /** Bumped by our own writes and by anybody else's — see below. */
  reloadKey: number;
  /** Run a line and say what it answered. */
  runCommand: (line: string) => Promise<void>;
  /** …and the same without the reload, for a gesture repeated dozens of times (a mute, a knob). */
  quietCommand: (line: string) => Promise<void>;
  bumpReload: () => void;
}

/** A command runner for one surface: its reload key is driven by `/revision`, since a tablet mostly follows edits that are not its own. */
export function useSurfaceCommands(
  setStatus: (s: string) => void,
  /** The lines this screen answers ITSELF, before `/command` is asked — the same seam `App`'s `runLocalCommand` is, for the same two reasons. */
  local?: (line: string) => boolean,
): SurfaceCommands {
  const [reloadKey, setReloadKey] = useState(0);
  const bumpReload = useCallback(() => setReloadKey((k) => k + 1), []);
  const rev = useRevision();
  // Someone else's edit — or ours, one tick later. The `null` guard keeps a mount to one pass.
  useEffect(() => {
    if (rev !== null) bumpReload();
  }, [rev, bumpReload]);

  // In a ref so the runner below keeps one identity: it is a key listener's dependency, and the handler rebinds as the surface's state moves.
  const localRef = useLatest(local);

  const send = useCallback(
    async (line: string, reload: boolean) => {
      if (localRef.current?.(line.trim())) return;
      try {
        // `want: []` always: the graph a command can build is for the chains canvas, and this screen has none.
        const { output, refused } = await api.command(line, { want: [] });
        const said = output.length ? output.join("  ·  ") : `ran: ${line}`;
        // A refusal reads as a refusal even here: this screen has one line of chrome, so the word has to be in the sentence.
        setStatus(refused ? m["srf.refused"]({ said }) : said);
      } catch (e) {
        setStatus(
          m["status.surface.commandFailed"]({ message: (e as Error).message }),
        );
      } finally {
        if (reload) bumpReload();
      }
    },
    [setStatus, bumpReload],
  );

  return {
    reloadKey,
    runCommand: useCallback((line: string) => send(line, true), [send]),
    quietCommand: useCallback((line: string) => send(line, false), [send]),
    bumpReload,
  };
}
