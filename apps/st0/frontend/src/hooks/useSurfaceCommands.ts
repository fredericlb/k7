// useSurfaceCommands.ts — running a command from a screen that is NOT the shell: an external
// surface has no command bar, no undo journal and no chains pane, so the three things App's
// `runCommand` exists to feed are all absent. What is left is the write, the reload it implies
// and one line to say what happened. See ../../docs/external.md.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
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

/**
 * A command runner for one surface.
 *
 * The reload key here is driven by `/revision` and not only by our own writes, which is the one
 * real difference from the shell's. A tablet is a SECOND screen on a project somebody is also
 * editing on the laptop, so the edits it must follow mostly are not its own; the shell can afford
 * to bump on its own writes because it is where the writes happen. The token moves for both, so
 * one poll answers both questions.
 *
 * That is also why nothing here calls `noteRevision`: adopting the token silently is a promise
 * that everything derived from it has already re-asked, and half of what this screen draws
 * (`useDocument` inside the timeline, the graph fetch beside it) is keyed on the token itself
 * rather than on the counter. The cost is one extra pass per local command, within two seconds,
 * on a screen that is drawing one surface.
 */
export function useSurfaceCommands(
  setStatus: (s: string) => void,
  /**
   * The lines this screen answers ITSELF, before `/command` is asked — true when it did.
   *
   * The same seam `App`'s `runLocalCommand` is, and it exists here for the same two reasons: some
   * verbs are the SHELL's (a pane, a panel — and out here, a caret or a zoom, which no service can
   * move), and the transport's four are the engine's own socket, which is a message this screen
   * already holds against an HTTP round trip that would send the identical one.
   */
  local?: (line: string) => boolean,
): SurfaceCommands {
  const [reloadKey, setReloadKey] = useState(0);
  const bumpReload = useCallback(() => setReloadKey((k) => k + 1), []);
  const rev = useRevision();
  // Someone else's edit — or ours, one tick later. The `null` guard keeps a mount to one pass.
  useEffect(() => {
    if (rev !== null) bumpReload();
  }, [rev, bumpReload]);

  // In a ref so the runner below keeps one identity: it is a key listener's dependency, and the
  // handler rebinds whenever the surface's own state moves.
  const localRef = useRef(local);
  localRef.current = local;

  const send = useCallback(
    async (line: string, reload: boolean) => {
      if (localRef.current?.(line.trim())) return;
      try {
        // `want: []` always: the graph the service can build alongside a command is for the chains
        // canvas to draw, and this screen has none. What the lane gutter needs of the graph is
        // fetched on the revision token instead, once, however many commands run.
        const { output, refused } = await api.command(line, { want: [] });
        const said = output.length ? output.join("  ·  ") : `ran: ${line}`;
        // A refusal reads as a refusal even here, where there is no colour to say it with: this
        // screen has one line of chrome, so the word has to be in the sentence.
        setStatus(refused ? `refusé — ${said}` : said);
      } catch (e) {
        setStatus(`command error: ${(e as Error).message}`);
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
