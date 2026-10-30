// useDiskSync — keep the open file in step with what is actually on disk.
//
// A clean buffer adopts the new text silently; a dirty one asks and does nothing until told.
// Gated on `/revision`, which moves for our own writes AND for edits made outside the app.
//
// This guards a data-loss bug: reading a file only once means a save writes a stale buffer over
// everything that happened since. See ../docs/shell.md.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useQuietWrites, useRevision } from "./useRevision";

/** What to do about a file that has changed underneath the editor — pure, since the branch that matters DISCARDS someone's typing. */
export type DiskAction =
  | "adopt" // no unsaved edits — take the new text, say nothing
  | "clean" // the buffer already equals disk; whatever made it dirty has been written by someone else
  | "conflict" // two real versions: ask
  | "ignore"; // the user said "keep editing" about exactly this text

export function decideDiskSync(p: {
  fresh: string;
  buffer: string;
  dirty: boolean;
  /** The version already dismissed with "keep editing", if any. */
  dismissed: string | null;
  /** What this editor last wrote or read; disk still holding it means only the typing since is new. */
  saved?: string;
}): DiskAction {
  if (p.fresh === p.buffer) return p.dirty ? "clean" : "ignore";
  // Our own last save, read back while the person keeps typing: nothing changed underneath.
  if (p.dirty && p.saved !== undefined && p.fresh === p.saved) return "ignore";
  if (!p.dirty) return "adopt";
  return p.fresh === p.dismissed ? "ignore" : "conflict";
}

export interface DiskSync {
  /** The on-disk text, when it differs from a buffer with unsaved edits. Null when there is nothing to decide. */
  conflict: string | null;
  /** Keep editing: dismiss this version. A LATER change on disk asks again. */
  keepEditing: () => void;
  /** Take the file from disk, dropping the unsaved edits. */
  takeDisk: () => void;
  /** Ask about this disk text now: a write refused as stale (409) is the same question, raised before the poll sees it. */
  raise: (fresh: string) => void;
}

export function useDiskSync({
  path,
  content,
  dirty,
  saved,
  onAdopt,
  onClean,
  onKeep,
  reloadKey,
}: {
  path: string | null;
  content: string | null;
  dirty: boolean;
  /** The text last written or read — see decideDiskSync. */
  saved: string;
  /** Replace the buffer with this text — a silent refresh, or the user choosing "update". */
  onAdopt: (text: string) => void;
  /** The buffer turned out to match disk after all: it is not dirty any more. */
  onClean: () => void;
  /** "Keep editing" about this disk text: it becomes the base the next write is checked against, so the buffer may go over it. */
  onKeep?: (fresh: string) => void;
  /** Bumped by the shell after a command, so an action is noticed without waiting for the next tick. */
  reloadKey: number;
}): DiskSync {
  const [conflict, setConflict] = useState<string | null>(null);

  // Read by the poll, which must not re-arm every keystroke: an interval that resets on each character never fires.
  const state = useRef({
    path,
    content,
    dirty,
    saved,
    onAdopt,
    onClean,
    onKeep,
  });
  state.current = { path, content, dirty, saved, onAdopt, onClean, onKeep };
  // The version the user already said 'keep editing' about: dismissing must not re-prompt for the SAME text, but a further change is new.
  const dismissed = useRef<string | null>(null);

  const rev = useRevision();
  // A knob this tab wrote moves no published token, and the file on screen may be the one it wrote.
  const quietWrites = useQuietWrites();
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is a TRIGGER, not a value this body reads — a command just ran and its write must be noticed now, whether or not the token moved.
  useEffect(() => {
    if (rev === null) return; // no token read yet — nothing has changed that we know of
    let alive = true;

    const check = async () => {
      const s = state.current;
      if (!s.path) return;
      let fresh: string;
      try {
        const f = await api.read(s.path);
        if (f.binary) return;
        fresh = f.content;
      } catch {
        return; // deleted, or the service is unreachable — the buffer is still the best thing we have
      }
      if (!alive || s.path !== state.current.path) return; // the user moved on mid-request
      const cur = state.current;
      switch (
        decideDiskSync({
          fresh,
          buffer: cur.content ?? "",
          dirty: cur.dirty,
          dismissed: dismissed.current,
          saved: cur.saved,
        })
      ) {
        case "adopt":
          cur.onAdopt(fresh);
          setConflict(null);
          dismissed.current = null;
          break;
        case "clean":
          cur.onClean();
          setConflict(null);
          dismissed.current = null;
          break;
        case "conflict":
          setConflict(fresh);
          break;
        // Nothing to ask any more — a banner raised over a version that is no longer the question goes.
        case "ignore":
          setConflict(null);
          break;
      }
    };

    void check();
    return () => {
      alive = false;
    };
    // reloadKey is a dependency deliberately: an action can change the answer without changing a source, and waiting for the token is late.
  }, [rev, reloadKey, quietWrites]);

  // A different file is a different question — never carry a decision across.
  useEffect(() => {
    setConflict(null);
    dismissed.current = null;
  }, [path]);

  const keepEditing = useCallback(() => {
    if (conflict !== null) state.current.onKeep?.(conflict);
    dismissed.current = conflict;
    setConflict(null);
  }, [conflict]);

  const raise = useCallback((fresh: string) => {
    const cur = state.current;
    if (fresh === (cur.content ?? "")) return cur.onClean();
    dismissed.current = null;
    setConflict(fresh);
  }, []);

  const takeDisk = useCallback(() => {
    if (conflict !== null) state.current.onAdopt(conflict);
    dismissed.current = null;
    setConflict(null);
  }, [conflict]);

  return { conflict, keepEditing, takeDisk, raise };
}
