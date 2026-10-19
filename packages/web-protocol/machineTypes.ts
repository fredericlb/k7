// machineTypes.ts — what a machine's file service lists: workspaces, surfaces, served projects,
// stem jobs, module libraries, and the shares and their comments. Re-exported by types.ts.

import type { ProjectApp } from "./projects.ts";
import type { FileNode } from "./workspaceTypes.ts";

/** A workspace under ~/.k7/root/<slug>/, as the picker lists them. */
export interface WorkspaceSummary {
  name: string; // the folder name (== the workspace name the user picks)
  projectCount: number; // project folders inside, at any depth (0 for empty)
  isSingleProject: boolean; // the folder itself is a project
}

/** Reply to GET /workspaces on the file service. */
export interface WorkspaceList {
  workspaces: WorkspaceSummary[];
}

/** One workspace on the machine with the projects it holds — the only side that can answer; see docs/machine.md. */
export interface AccountWorkspace {
  name: string;
  isSingleProject: boolean;
  projects: RepoProject[];
}

/** Reply to GET /workspaces/projects on the file service. */
export interface AccountWorkspaceList {
  workspaces: AccountWorkspace[];
}

/** One surface a project declares, named and typed — enough to build its address and to gate a device. */
export interface SurfaceRef {
  id: string;
  type: string;
}

/** One project declaring at least one surface, identity fields flattened onto it — see docs/machine.md. */
export interface SurfacedProject {
  workspace: string;
  path: string;
  app: ProjectApp;
  active: boolean;
  surfaces: SurfaceRef[];
}

/** Reply to GET /workspaces/surfaces; not @studio/song's `ProjectSurfaces` — see docs/machine.md. */
export interface SurfacedProjectList {
  projects: SurfacedProject[];
}

/** GET /engine/served — what the session actually LOADED, which is not `SurfacedProject.active`; see docs/machine.md. */
export interface ServedProject {
  workspace: string;
  /** Workspace-relative, `.` for a lone-project workspace — `SurfacedProject.path`'s spelling. */
  path: string;
}

/** Reply to GET /engine/served; `project: null` means the engine holds nothing for this person. */
export interface ServedProjectReply {
  project: ServedProject | null;
}

/** How a stem separation is doing, and the `files` it produced; see docs/machine.md. */
export interface SeparateJob {
  id: string;
  source: string; // the mix being split, absolute on the engine's machine
  done: boolean;
  failed: boolean;
  error: string | null;
  phase: string; // "queued" | "decoding" | "loading model" | "separating" | "writing" | "done" | "failed"
  percent: number | null; // null while doing something with no measurable end
  lines: string[]; // notes worth reading — which execution provider won, and why a run failed
  files: string[]; // the stems written, absolute. Empty until `done`.
}

/** What `POST /stems` answers: `ready` is the disk, `job` only when there was work — see docs/machine.md. */
export interface StemsReply {
  ready: boolean;
  job: SeparateJob | null;
}

/** One project inside a repository; the folder's NAME decides which app opens it — see ./projects.ts. */
export interface RepoProject {
  path: string;
  app: ProjectApp;
  /** `project.tags` of an k7 project's project.k7x; absent when it has none. */
  tags?: string[];
  /** The TYPES of the surfaces it declares (`timeline`, `turntables`…), which is what its archetype was; absent from an older service. */
  surfaces?: string[];
  /** Whether it is its workspace's active project, the one the engine plays — docs/machine.md. */
  active?: boolean;
  /** When a file in it last changed on this replica, epoch ms, from a walk two levels deep. */
  editedAt?: number;
  /** A bundled demo, overwritten on the service's next start — the home page says so; absent otherwise. */
  demo?: boolean;
}

/** One module LIBRARY a project can reach, nearest first; `exists: false` is a state, not an absence — docs/machine.md. */
export interface ModuleLibrary {
  /** The `@`-prefixed level a chain writes: `workspace`, `k7`, `engine`. */
  ns: string;
  /** Workspace-relative, so every other route takes it as-is; EMPTY for `@engine`, which has no folder. */
  path: string;
  exists: boolean;
  /** Nothing here can be created, renamed or written — true for `@engine` alone; see docs/machine.md. */
  readOnly?: boolean;
  nodes: FileNode[];
  /** A library's shared SOUNDS, beside its modules — what a tap and a cabinet pick, and where a drop lands (@studio/song's libraryFiles.md). */
  samples?: FileNode[];
  irs?: FileNode[];
  /** …its WAVETABLES, what a Faust instrument's table slot picks (@studio/song's faustFiles.md). */
  wavetables?: FileNode[];
  /** …and its shared amp MODELS, what an amp's `model` may pick besides its own assets. */
  models?: FileNode[];
  /** For one of the origin's libraries: the version this workspace plays, and the newest this k7 could move to. */
  version?: { pinned: number | "draft"; requires?: number; upgrade?: number };
}

/** One project a person shared, at a checkpoint — the AUTHOR's view, which no public route serves; see docs/machine.md. */
export interface ShareSummary {
  /** `sha256(token)` — the directory's name on the volume, and the `:key` in every route. */
  key: string;
  /** The secret in the link. Blank once revoked. */
  token: string;
  /** The project's name, for this list and for the visitor's header. */
  name: string;
  /** Where it came from. For the author alone: it says what is on their disk. */
  origin: { repo: string; project: string };
  createdAt: string;
  /** Everything the share weighs on the volume — the number that makes the cost visible. */
  bytes: number;
  /** The point of the workspace's history it plays, as the history lists it. */
  checkpoint: { seq: number; name: string };
  /** Set once revoked. The row SURVIVES dated: a share that vanished would leave a doubt. */
  revokedAt?: string;
  /** How many comments sit in each state — COUNTED on the way out, never stored on the row. */
  comments?: CommentCounts;
}

/** The version of `ShareManifest` this code writes and reads; any other is a share it cannot open. */
export const SHARE_SCHEMA = 2;

/** Where a share's own files sit, in the document the engine plays: the server puts its folder there. */
export const SHARE_ROOT = "k7-share:";

/** A share as the media library holds it (`snapshot.json`); apps/k7/backend/docs/media/shares.md. */
export interface ShareManifest {
  schema: number;
  name: string;
  createdAt: string;
  /** The checkpoint it was made at: the version shared, which later edits do not reach. */
  checkpoint: { workspace: string; seq: number; name: string };
  /** The documents a browser draws it from, by filename — what the viewer may ask for, and nothing else. */
  docs: string[];
  /** The document the server's engine plays, its own files named under `SHARE_ROOT`. */
  engineDoc: string;
  /** Every file the share carries, relative to its folder. */
  files: { path: string; bytes: number }[];
  bytes: number;
}

/** One stage of making a share, as the author's progress bar draws it — packages/file-service/docs/share.md. */
export type ShareStep =
  | "sync"
  | "freeze"
  | "checkpoint"
  | "pack"
  | "upload"
  | "done"
  | "failed";

/** Where a share being made is: `done`/`total` count the step's own units (renders, bytes). */
export interface ShareProgress {
  step: ShareStep;
  done: number;
  total: number;
  /** What the step is on: a module being rendered, a file being sent. */
  detail?: string;
  /** Set on `failed`: the sentence the author reads. */
  error?: string;
  /** Set on `done`. */
  token?: string;
  bytes?: number;
}

/** A workspace's files at one checkpoint, from the hub: texts verbatim, binaries as the path of their bytes there. */
export interface CheckpointFiles {
  seq: number;
  texts: Record<string, string>;
  blobs: Record<string, { path: string; size: number }>;
}

/** What an author does with a comment. `active` is where every one lands; see apps/k7/backend/docs/media/comments.md. */
export type CommentState = "active" | "resolved" | "ignored";

/** One block of text a visitor left on a frozen snapshot — public, so it carries no identity beyond a chosen name. */
export interface ShareComment {
  id: number;
  /** What the visitor typed as their name, or "" — a share has no accounts, so this is a claim and not a fact. */
  author: string;
  body: string;
  /** Where the playhead was, in seconds, or null — a comment about the whole song has no timecode. */
  at: number | null;
  state: CommentState;
  createdAt: string;
  /** When the state last moved. Equal to `createdAt` until an author touches it. */
  updatedAt: string;
}

/** The three tabs' sizes, in one object — the author's list and the row's badge read the same numbers. */
export interface CommentCounts {
  active: number;
  resolved: number;
  ignored: number;
}
