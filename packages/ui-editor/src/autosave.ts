// autosave.ts — an editor with no Save button. The buffer is written as soon as it is a
// document the compiler could read, and held back — visibly — for as long as it is not, so a
// half-typed line never reaches the loader. The rule, its timer and the held text live here
// because six panes across four apps share them. See docs/autosave.md.

import {
  firstIssue,
  type ModuleIssue,
  type Validity,
  validateFile,
} from "@studio/song/yaml/validate";
import { useCallback, useEffect, useRef, useState } from "react";

/** How long the keystrokes must stop before the buffer is written. A second, and not less: in
 *  st0 a write also re-reads the tree, the hints and the compiled project. */
export const AUTOSAVE_DELAY_MS = 1000;

export type AutosaveStatus =
  | "clean" // the buffer is what is on disk
  | "pending" // edited, waiting for the typing to stop
  | "saving"
  | "held" // edited and deliberately NOT written: it would not compile
  | "error"; // the write itself failed

export interface AutosaveAct {
  act: "idle" | "write" | "hold";
  /** What is wrong, for the status line. Set on `hold`, and on a `write` made anyway. */
  reason: string | null;
}

/**
 * Write, hold, or do nothing — the whole policy, pure so it can be exercised without a browser.
 *
 * `baselineOk` is what saves this from being a trap: a file that ALREADY fails its schema on
 * disk — a key this build does not know, a project written by a newer one — would otherwise be
 * uneditable forever, since nothing you typed could make it valid and there is no button left
 * to overrule it. Autosave's promise is that it never makes a file worse, not that it fixes it,
 * so when disk is already refused only malformed TEXT holds the write back.
 */
export function decideAutosave(p: {
  dirty: boolean;
  validity: Validity;
  baselineOk: boolean;
}): AutosaveAct {
  if (!p.dirty) return { act: "idle", reason: null };
  if (p.validity.ok) return { act: "write", reason: null };
  const reason = firstIssue(p.validity);
  if (p.validity.malformed) return { act: "hold", reason };
  return p.baselineOk ? { act: "hold", reason } : { act: "write", reason };
}

// Text that could not be written, by path. Held OUTSIDE React: the point is to survive the pane
// unmounting — closing the popin, switching file, leaving the view — which is exactly when an
// unwritable buffer would otherwise be dropped on the floor without anyone being told.
const held = new Map<string, string>();

/** Keep a buffer that could not be written. */
export const keepBuffer = (path: string, text: string): void => {
  held.set(path, text);
};
/** The unwritten buffer for a path, for an editor about to show what is on disk instead. */
export const recallBuffer = (path: string): string | null =>
  held.get(path) ?? null;
/** Forget it — it landed, or the user chose disk. */
export const dropBuffer = (path: string): void => {
  held.delete(path);
};
/** Forget it only if what is held is the text that just landed: anything typed since stays. */
export const settleBuffer = (path: string, landed: string): void => {
  if (held.get(path) === landed) held.delete(path);
};

export interface Autosave {
  status: AutosaveStatus;
  /** Why it is held, or why the write failed. Null when there is nothing to say. */
  reason: string | null;
  /** The open buffer's findings, for a gutter. Refreshed each time the timer fires. */
  issues: ModuleIssue[];
  /**
   * Write now if it can be written — Ctrl+S and vim's `:w` still mean "now", and in `manual`
   * mode this is the only thing that ever writes.
   *
   * Resolves to whether the buffer is ON DISK afterwards: false when it was held back because
   * it would not compile, or when the write itself failed. A screen saving several files at
   * once needs that answer before it does anything that assumes they all landed — committing
   * them, for instance.
   */
  flush: () => Promise<boolean>;
}

// Loudest first: a screen showing one badge for several files must show the one that needs
// something, not the one that happens to be first.
const LOUDNESS: AutosaveStatus[] = [
  "error",
  "held",
  "saving",
  "pending",
  "clean",
];

/** The loudest of several autosaves, for a screen editing more than one file at once. */
export function loudest(all: Autosave[]): {
  status: AutosaveStatus;
  reason: string | null;
} {
  for (const status of LOUDNESS) {
    const hit = all.find((a) => a.status === status);
    if (hit) return { status, reason: hit.reason };
  }
  return { status: "clean", reason: null };
}

interface Live {
  path: string | null;
  text: string;
  saved: string;
  enabled: boolean;
  write: (text: string) => Promise<void>;
  validate: (path: string, text: string) => Validity;
}

export function useAutosave({
  path,
  text,
  saved,
  write,
  enabled = true,
  manual = false,
  delayMs = AUTOSAVE_DELAY_MS,
  validate = validateFile,
}: {
  /** The open file, or null when nothing is. */
  path: string | null;
  /** The buffer. */
  text: string;
  /** What is on disk: the last text read or written. Dirty is derived from the two, never a
   *  flag — a flag is what a failed save leaves lying. */
  saved: string;
  /** Write it. Resolves when it landed, and the caller moves `saved` to what it wrote. */
  write: (text: string) => Promise<void>;
  enabled?: boolean;
  /**
   * Never write on a timer: `flush()` is the only thing that writes.
   *
   * Everything else is unchanged — the same validation, the same held-back reason, the same
   * kept buffer — because "when does it write" and "may it be written" are different questions
   * and only the first one moves. A screen in this mode has a Save button.
   *
   * The one real difference is what happens when the pane closes with an unsaved buffer. On a
   * timer that is the last chance and it is TAKEN; here the whole point is that nobody writes
   * without being asked, so the buffer is KEPT instead and comes back with the file
   * (`recallBuffer`). Nothing is lost either way; what differs is who decided.
   */
  manual?: boolean;
  delayMs?: number;
  /** How this file is judged. The default is the project-file router; a pane editing
   *  something else (a médiathèque sidecar) may hand its own. */
  validate?: (path: string, text: string) => Validity;
}): Autosave {
  const [status, setStatus] = useState<AutosaveStatus>("clean");
  const [reason, setReason] = useState<string | null>(null);
  const [issues, setIssues] = useState<ModuleIssue[]>([]);

  // Read by the timer, which must not re-arm on every keystroke.
  const live = useRef<Live>({ path, text, saved, enabled, write, validate });
  live.current = { path, text, saved, enabled, write, validate };
  // The values of the PREVIOUS commit, so the cleanup below flushes the file that is closing
  // rather than the one that just opened — `live` has already moved on by then. Updated by the
  // LAST effect in this hook, which is what keeps it one commit behind everything above it.
  const previous = useRef<Live>(live.current);

  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disarm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // The timer, and the indirection that lets a finished write re-arm the very function that
  // started it: `arm` is stable, `run` is read fresh when it fires.
  const runRef = useRef<(s: Live) => Promise<boolean>>(async () => false);
  const arm = useCallback(
    (ms: number) => {
      disarm();
      timer.current = setTimeout(() => {
        timer.current = null;
        void runRef.current(live.current);
      }, ms);
    },
    [disarm],
  );

  const run = useCallback(
    async (s: Live): Promise<boolean> => {
      if (!s.path || !s.enabled) return false;
      if (busy.current) {
        // A write is already in flight; a second one would race it. But this call may be the
        // last chance this text gets — the pane is closing — so it is kept rather than dropped.
        if (s.text !== s.saved) keepBuffer(s.path, s.text);
        return false;
      }
      // Only the pane still showing this file may repaint the status.
      const showing = () => live.current.path === s.path;
      if (s.text === s.saved) {
        dropBuffer(s.path);
        if (showing()) {
          setStatus("clean");
          setReason(null);
          setIssues([]);
        }
        return true; // already on disk, which is what the caller is asking about
      }
      const validity = s.validate(s.path, s.text);
      if (showing()) setIssues(validity.issues);
      const decision = decideAutosave({
        dirty: true,
        validity,
        baselineOk: s.validate(s.path, s.saved).ok,
      });
      if (decision.act !== "write") {
        keepBuffer(s.path, s.text);
        if (showing()) {
          setStatus("held");
          setReason(decision.reason);
        }
        return false;
      }
      busy.current = true;
      if (showing()) {
        setStatus("saving");
        setReason(decision.reason);
      }
      let wrote = false;
      try {
        await s.write(s.text);
        settleBuffer(s.path, s.text);
        wrote = true;
        if (showing())
          setStatus(live.current.text === s.text ? "clean" : "pending");
      } catch (e) {
        keepBuffer(s.path, s.text);
        if (showing()) {
          setStatus("error");
          setReason((e as Error).message);
        }
      } finally {
        busy.current = false;
        // The buffer moved while the write was in flight — that edit is still unwritten.
        // Not in manual mode: there, only Save writes, and re-arming would be a timer.
        const now = live.current;
        if (!manual && now.path === s.path && now.text !== now.saved)
          arm(delayMs);
      }
      return wrote;
    },
    [delayMs, arm, manual],
  );
  runRef.current = run;

  useEffect(() => {
    if (!path || !enabled) return;
    // The commit where the file CHANGED shows the new path beside the old buffer, because the
    // host reads asynchronously. Nothing may be written from that pairing — it would put one
    // file's text at another file's path. One commit later the buffer has caught up.
    if (previous.current.path !== path) {
      disarm();
      setStatus("clean");
      setReason(null);
      setIssues([]);
      return;
    }
    if (text === saved) {
      disarm();
      dropBuffer(path);
      setStatus((s) => (s === "saving" ? s : "clean"));
      setReason(null);
      setIssues([]);
      return;
    }
    setStatus((s) => (s === "saving" ? s : "pending"));
    // Manual: the buffer is dirty and stays that way until somebody presses Save. The status
    // still says `pending`, which is exactly what it means — edited, not on disk.
    if (manual) return;
    arm(delayMs);
    return disarm;
  }, [path, text, saved, enabled, manual, delayMs, arm, disarm]);

  // The file is closing (another one opened, or the pane went away). Whatever is pending gets
  // its chance now — and if it cannot be written it is kept, not lost.
  //
  // `path` is not read in the cleanup and is exactly why this effect exists: without it the
  // flush would happen on unmount only, and every file left mid-edit for another one would go
  // unwritten. Hence the suppression.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `path` is the trigger, see above
  useEffect(
    () => () => {
      const s = previous.current;
      // MANUAL: closing is not permission to write. The buffer is kept instead, and comes back
      // with the file — `recallBuffer` is what the builder reads on load. Nothing is lost; the
      // difference from the timer path is only who decided to write it.
      if (manual) {
        if (s.path && s.text !== s.saved) keepBuffer(s.path, s.text);
        return;
      }
      void run(s);
    },
    [path, run, manual],
  );

  const flush = useCallback(async (): Promise<boolean> => {
    disarm();
    if (previous.current.path !== live.current.path) return false; // buffer not settled — see above
    return run(live.current);
  }, [run, disarm]);

  // LAST, deliberately: everything above reads `previous` as the state of the commit before
  // this one, and this is what makes that true.
  //
  // An UNSETTLED commit — new path, buffer still the old file's — is recorded as if there were
  // nothing pending, so the closing flush cannot write one file's text at another file's path.
  useEffect(() => {
    const settled = previous.current.path === path;
    previous.current = {
      path,
      text: settled ? text : saved,
      saved,
      enabled,
      write,
      validate,
    };
  });

  return { status, reason, issues, flush };
}
