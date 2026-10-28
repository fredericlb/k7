// autosave.ts — an editor with no Save button. The buffer is written as soon as it is a
// document the compiler could read, and held back — visibly — for as long as it is not, so a
// half-typed line never reaches the loader. The rule and its timer live here because six panes
// across four apps share them; the held text, in autosaveBuffers.ts. See docs/autosave.md.

import {
  firstIssue,
  type ModuleIssue,
  type Validity,
  validateFile,
} from "@studio/song-schema/yaml/validate";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  addFlusher,
  dropBuffer,
  keepBuffer,
  settleBuffer,
} from "./autosaveBuffers.ts";
import { useUnsavedGuard } from "./unsaved.ts";

/** How long the keystrokes must stop before the buffer is written — a second, and why, in docs/autosave.md. */
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

/** Write, hold, or do nothing — the whole policy, pure, and `baselineOk` is the escape hatch (docs/autosave.md). */
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

/** A pane's judge of the on-disk text, remembered while that text is the same string: it is asked on every fire otherwise. */
// Keyed on path and text alone: a pane's `validate` is its file kind's fixed rule, and a host may hand a fresh closure each render.
export function baselineMemo(): (
  validate: (path: string, text: string) => Validity,
  path: string,
  saved: string,
) => boolean {
  let last: { path: string; saved: string; ok: boolean } | null = null;
  return (validate, path, saved) => {
    if (last?.path === path && last.saved === saved) return last.ok;
    const ok = validate(path, saved).ok;
    last = { path, saved, ok };
    return ok;
  };
}

export {
  dropBuffer,
  flushAutosaves,
  forgetBuffers,
  keepBuffer,
  recallBuffer,
  settleBuffer,
} from "./autosaveBuffers.ts";

export interface Autosave {
  status: AutosaveStatus;
  /** Why it is held, or why the write failed. Null when there is nothing to say. */
  reason: string | null;
  /** The open buffer's findings, for a gutter. Refreshed each time the timer fires. */
  issues: ModuleIssue[];
  /** Write now if it can be written, resolving to whether the buffer is ON DISK afterwards — docs/autosave.md. */
  flush: () => Promise<boolean>;
}

// Loudest first: one badge for several files must show the one that needs something, not the first one.
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
  /** What is on disk: the last text read or written, since dirty is derived from the two and never a flag. */
  saved: string;
  /** Write it. Resolves when it landed, and the caller moves `saved` to what it wrote. */
  write: (text: string) => Promise<void>;
  enabled?: boolean;
  /** Never write on a timer: `flush()` is the only thing that writes, and closing keeps rather than saves. */
  manual?: boolean;
  delayMs?: number;
  /** How this file is judged; the default is the project-file router, and a pane editing something else hands its own. */
  validate?: (path: string, text: string) => Validity;
}): Autosave {
  const [status, setStatus] = useState<AutosaveStatus>("clean");
  const [reason, setReason] = useState<string | null>(null);
  const [issues, setIssues] = useState<ModuleIssue[]>([]);

  // Read by the timer, which must not re-arm on every keystroke.
  const live = useRef<Live>({ path, text, saved, enabled, write, validate });
  live.current = { path, text, saved, enabled, write, validate };
  // The values of the PREVIOUS commit, so the cleanup below flushes the file that is closing — see docs/autosave.md.
  const previous = useRef<Live>(live.current);

  const busy = useRef(false);
  const baseline = useRef<ReturnType<typeof baselineMemo> | null>(null);
  baseline.current ??= baselineMemo();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disarm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // The indirection that lets a finished write re-arm what started it: `arm` is stable, `run` is read fresh.
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
      if (!s.path) return false;
      // Paused — a conflict being asked about: nothing is written, and the text is kept rather than dropped on a close.
      if (!s.enabled) {
        if (s.text !== s.saved) keepBuffer(s.path, s.text);
        return false;
      }
      if (busy.current) {
        // A write is in flight and a second would race it, but this may be the text's last chance, so it is kept.
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
      // Only a buffer that parses and fails its schema asks about the disk — and the disk's answer is kept until it changes.
      const decision = decideAutosave({
        dirty: true,
        validity,
        baselineOk:
          validity.ok ||
          validity.malformed ||
          !!baseline.current?.(s.validate, s.path, s.saved),
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
        // The buffer moved while the write was in flight, so that edit is still unwritten — never in manual mode.
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
    // The commit where the file CHANGED pairs a new path with the old buffer, and nothing may be written from it.
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
    // Manual: the buffer stays dirty until somebody presses Save, and `pending` is exactly what that means.
    if (manual) return;
    arm(delayMs);
    return disarm;
  }, [path, text, saved, enabled, manual, delayMs, arm, disarm]);

  // The file is closing, so whatever is pending gets its chance now, and what cannot be written is kept.

  // biome-ignore lint/correctness/useExhaustiveDependencies: `path` is the trigger — without it this flushes on unmount only
  useEffect(
    () => () => {
      const s = previous.current;
      // MANUAL: closing is not permission to write, so the buffer is kept and comes back with the file.
      if (manual) {
        if (s.path && s.text !== s.saved) keepBuffer(s.path, s.text);
        return;
      }
      void run(s);
    },
    [path, run, manual],
  );

  // Anything but `clean` is text this pane holds and the disk does not — the reload has to ask first.
  useUnsavedGuard(status !== "clean");

  const flush = useCallback(async (): Promise<boolean> => {
    disarm();
    if (previous.current.path !== live.current.path) return false; // buffer not settled — see above
    return run(live.current);
  }, [run, disarm]);

  // A MANUAL draft is not written for someone else's sake: it only answers whether it is clean.
  useEffect(() => {
    const f = async (): Promise<boolean> => {
      const s = live.current;
      if (!s.path || s.text === s.saved) return true;
      return manual ? false : flush();
    };
    return addFlusher(f);
  }, [flush, manual]);

  // LAST, deliberately, since everything above reads `previous` as the commit before this one.

  // An UNSETTLED commit is recorded as if nothing were pending — see docs/autosave.md.
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
