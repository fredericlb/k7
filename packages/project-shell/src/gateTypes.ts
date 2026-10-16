// gateTypes.ts — the shapes the project gate is built from: the phase it is in, what it needs
// about its engine, and the wording an app hands it. ProjectGate.tsx re-exports the public two.

import type { ProjectSyncState } from "@studio/web-protocol";
import type { EngineLoadStrings } from "./EngineLoadScreen.tsx";
import type { FileServiceFault } from "./fileApi.ts";
import type { SyncWaitStrings } from "./syncWait.tsx";

export type GatePhase =
  | { k: "resolving" }
  // A wait with no measure: the bench's catalogue being fetched.
  | { k: "cloning"; workspace: string; phase: string }
  | { k: "error"; message: string; fault?: FileServiceFault; lines?: string[] }
  // The machine answered and has no such folder — its own screen, see docs/launch.md.
  | { k: "missing"; message: string }
  // The account has no library repository, so nothing resolves and nothing retries — docs/launch.md.
  | { k: "no-libraries" }
  // The workspace opened and holds no project at all — the host app's wizard, see docs/launch.md.
  | { k: "empty"; workspace: string }
  // Nobody has touched this tab for a long time; the one button reopens it — see docs/idle.md.
  /** `why` decides whether waking is automatic: a tab put behind another wakes itself. */
  | { k: "idle"; why: "timeout" | "hidden" }
  // Still arriving from the relay; nothing opens before it is all here — see syncWait.tsx.
  | { k: "syncing"; workspace: string; sync: ProjectSyncState | null }
  // Opened, and on its way to the engine — copied, applied, dry-run; see EngineLoadScreen.tsx.
  | { k: "loading"; workspace: string; project: string }
  | { k: "open"; workspace: string; project: string };

/** What the gate needs about its engine, structurally — see docs/launch.md. */
export interface GateEngine {
  fileBase: string | null | undefined;
  token: string | null | undefined;
  /** What the file service takes instead of `token`, when the server hosts the files — engine-browser's `fileTokenOf`. */
  fileToken?: string | null;
  /** The engine ITSELF, for its id, nested as `RankedEngine` already has it — docs/launch.md. */
  engine: { id: string };
  /** A new hub ticket when `fileToken` expires under an open session — the app's `freshTicket`; absent with no hub. */
  renewTicket?: () => Promise<string | null>;
}

export interface ProjectGateStrings {
  cloning: (workspace: string) => string;
  back: string;
  unreachableTitle: string;
  unreachableBody: (base: string) => string;
  blockedTitle: string;
  blockedBody: (origin: string) => string;
  bothBody: string;
  retry: string;
  /** The project named is not in the workspace — a wording apart, because nothing is broken. */
  missingTitle: string;
  missingBody: string;
  /** No library repository on the account. Nothing is broken either; the account is unfinished. */
  librariesTitle: string;
  librariesBody: string;
  /** The bench's wait — a catalogue fetch, not a clone. Optional, see docs/launch.md. */
  benchWorkspace?: string;
  benchFetching?: string;
  /** A workspace holding no project at all — a state a NEW workspace can be left in, docs/launch.md. */
  emptyWorkspace?: string;
  /** The idle screen. Optional like the bench's, and for the same reason — docs/launch.md. */
  idleTitle?: string;
  idleBody?: string;
  resume?: string;
  /** The wait for the engine after the project opened; English when an app passes none. */
  loading?: EngineLoadStrings;
  /** The wait for sync before it opens; English when an app passes none. */
  syncing?: SyncWaitStrings;
}
