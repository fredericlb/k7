// syncConflicts.ts — the workspace's open sync conflicts, as the file service lists them: one store per
// page, refetched on open, on every sync notice for this workspace and on every revision move.
// A conflict is an edit the relay SET ASIDE, never lost: packages/live-sync/docs/sync.md. See docs/conflicts.md.

import { fget, fsend } from "@studio/project-shell/fileApi";
import { currentWorkspace, subscribeWorkspace } from "./syncFeed";

/** The shape of `Conflict` in @studio/live-sync/ops, as served — copied, the frontend does not depend on that package. */
export interface SyncConflict {
  id: string;
  seq: number;
  replica: string;
  ts: number;
  label: string;
  op:
    | {
        kind: "yaml";
        file: string;
        ops: (
          | { op: "set"; path: string[]; yaml: string }
          | { op: "delete"; path: string[] }
        )[];
      }
    | { kind: "text"; file: string; text: string }
    | { kind: "remove"; file: string };
  kept?: string | null;
}

/** What each side of a conflict IS, for a reader: a YAML value, or a word for a whole file. */
export type Side =
  | { k: "value"; yaml: string }
  | { k: "absent" }
  | { k: "text" }
  | { k: "binary" }
  | { k: "removed" }
  | { k: "current" };

export interface ConflictView {
  file: string;
  /** Dotted YAML paths, for a YAML op; empty for a whole file. */
  paths: string[];
  kept: Side;
  alternative: Side;
}

export function describeConflict(c: SyncConflict): ConflictView {
  const op = c.op;
  if (op.kind === "yaml") {
    const first = op.ops[0];
    return {
      file: op.file,
      paths: op.ops.map((o) => o.path.join(".")),
      kept:
        c.kept === undefined
          ? { k: "current" }
          : c.kept === null
            ? { k: "absent" }
            : { k: "value", yaml: c.kept },
      alternative:
        first?.op === "set"
          ? { k: "value", yaml: first.yaml }
          : { k: "absent" },
    };
  }
  return {
    file: op.file,
    paths: [],
    kept: { k: "current" },
    // A blob ref is a text opening on NUL: packages/file-hub/docs/blobs.md.
    alternative:
      op.kind === "remove"
        ? { k: "removed" }
        : op.text.startsWith("\u0000")
          ? { k: "binary" }
          : { k: "text" },
  };
}

export const conflictsApi = {
  /** The open conflicts; none where the workspace is not linked to a relay (404). */
  list: async (): Promise<SyncConflict[]> => {
    try {
      return (await fget<{ conflicts: SyncConflict[] }>("/sync/conflicts"))
        .conflicts;
    } catch (e) {
      if ((e as { status?: number }).status === 404) return [];
      throw e;
    }
  },
  /** `take`: write the alternative over the value in place; either way the conflict closes everywhere. */
  settle: (id: string, take: boolean) =>
    fsend<{ ok: true }>("POST", `/sync/conflicts/${encodeURIComponent(id)}`, {
      take,
    }),
};

export interface ConflictsState {
  conflicts: SyncConflict[];
  error: string;
}

const EMPTY: ConflictsState = { conflicts: [], error: "" };

/** A refcounted store over `list`: one fetch at a time, and one more when asked while it ran. */
export function createConflictsStore(
  list: () => Promise<SyncConflict[]>,
  push: (notice: () => void) => () => void,
  enabled: () => boolean,
) {
  let state = EMPTY;
  const listeners = new Set<() => void>();
  let inFlight = false;
  let again = false;
  let unpush: (() => void) | null = null;

  const set = (next: ConflictsState) => {
    state = next;
    for (const l of listeners) l();
  };
  const refresh = async (): Promise<void> => {
    if (!enabled()) return;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    try {
      set({ conflicts: await list(), error: "" });
    } catch (e) {
      set({ ...state, error: (e as Error).message });
    } finally {
      inFlight = false;
      if (again) {
        again = false;
        void refresh();
      }
    }
  };

  return {
    subscribe: (l: () => void) => {
      listeners.add(l);
      if (listeners.size === 1) {
        unpush = push(() => void refresh());
        void refresh();
      }
      return () => {
        listeners.delete(l);
        if (listeners.size === 0) {
          unpush?.();
          unpush = null;
        }
      };
    },
    get: () => state,
    refresh,
  };
}

export const conflictsStore = createConflictsStore(
  conflictsApi.list,
  (notice) => subscribeWorkspace(notice, (live) => live && notice()),
  () => currentWorkspace() !== null,
);

// The right column opens on the panel from wherever a conflict is shown (a banner over the editor).
const openers = new Set<() => void>();

export function openConflictsPanel(): void {
  for (const o of openers) o();
}

export function onOpenConflictsPanel(fn: () => void): () => void {
  openers.add(fn);
  return () => openers.delete(fn);
}
