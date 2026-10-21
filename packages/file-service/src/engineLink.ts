// engineLink.ts — run the brain's command layer and drive the LOCAL C++ engine, dialled
// once at boot. One engine, but one SESSION per workspace owner: `served` says what this
// service sent to each of them, so a re-send or a take resolves its workspace explicitly.
// The one singleton is the document a browser hands over — see docs/activeProject.md.

import { watch } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import {
  argClass,
  argHint,
  type CompletionItem,
  completionItems,
  loadCommandSpecs,
  runCommand,
} from "@studio/commands/commandSpec";
import type { CommandHost, TransportAction } from "@studio/commands/commands";
import type {
  EngineClient,
  PluginInfo,
  RecordedTake,
} from "@studio/engine-client/engineClient";
import type { WebGraph } from "@studio/graph-model";
import { patternFiles } from "@studio/song/enginePattern";
import { listBaseModules, withModuleStamp } from "@studio/song/loader";
import { loadPreferences } from "@studio/song/preferences";
import type { ProjectDoc } from "@studio/song/project";
import { addTakeToEvent, addTakeToTrack } from "@studio/take-render/recordTake";
import type {
  ChangedFile,
  CommandInfo,
  EngineLoadPhase,
  EngineScanState,
  EngineSyncState,
} from "@studio/web-protocol";
import { climbsOut } from "@studio/web-protocol/paths";
import { autoFreezer } from "./autoFreezeJobs.ts";
import { guard } from "./background.ts";
import { engineQueries, serviceMembers } from "./commandHost.ts";
import { armOnceOpen } from "./engineArm.ts";
import {
  beginLoad,
  endLoad,
  isWarming,
  loadPhase,
  type WarmDeps,
  warmUp,
} from "./engineLoad.ts";
import { awaitSessions, reconcileEngine } from "./engineReconcile.ts";
import { engineScanOf, forgetScanWait, scanHolds } from "./engineScanGate.ts";
import {
  dropLink,
  ensureEngine,
  flushProject,
  hasSelectedEngine,
  isReady,
  linkHooks,
  links,
  noteServed,
  selectedEngine,
  served,
  sessionOf,
} from "./engineSessions.ts";
import {
  engineSyncState,
  forgetSyncFailure,
  sendWhenSynced,
} from "./engineSync.ts";
import { namedSongFiles } from "./mediatekPrefetch.ts";
import {
  closeModuleWatch,
  moduleFoldersMoved,
  watchModuleFolders,
} from "./moduleWatch.ts";
import { saveTake } from "./recorderSave.ts";
import { serviceRenderer } from "./renderers.ts";
import { setTakeArm, takeArmOf, withTakeHole } from "./takeArm.ts";
import { setTimelinePlay, withTimelinePlay } from "./timelinePlay.ts";
import { skip, type Workspace } from "./workspace.ts";
import type { JournalMode } from "./workspaceHistory.ts";

export {
  awaitPluginParams,
  NATIVE_UI_TIMEOUT_MS,
  PLUGIN_BASE_TIMEOUT_MS,
  PLUGIN_PARAMS_TIMEOUT_MS,
  type PluginParamAnswer,
  type PluginParamListingClient,
  pluginParams,
  showNativePluginUIOf,
  snapshotPluginBase,
} from "./enginePluginQueries.ts";
export {
  awaitSessions,
  RECONCILE_EVERY_MS,
  RESEND_LIMIT,
  SESSIONS_TIMEOUT_MS,
  type SessionListingClient,
} from "./engineReconcile.ts";
// The sessions, the plugin queries and the reconcile live beside this file; their public names stay importable here.
export {
  clearSelectedEngine,
  ensureEngine,
  noteOwner,
  pruneIdleLinks,
  servedProject,
  sessionOf,
  setSelectedEngine,
} from "./engineSessions.ts";

const SURFACE = "cli" as const; // the one surface the shared registry defines
const NO_PROJECT =
  "no active project — select a project in the workspace first";
const NO_ENGINE = "engine offline — is the C++ engine running on this machine?";

/** How often each served project is looked at for a VST render to make — cheap when nothing moved. */
const AUTO_FREEZE_EVERY_MS = 3_000;
let autoFreezeTimer: ReturnType<typeof setInterval> | null = null;

/** Freeze VST tracks while nobody is listening — autoFreezeJobs.ts, packages/song/docs/autoFreeze.md. */
function startAutoFreeze(): void {
  if (autoFreezeTimer) return;
  autoFreezeTimer = setInterval(() => {
    for (const [session, s] of served) {
      const link = links.get(session);
      if (!link?.ready) continue;
      guard(
        "auto-freeze",
        autoFreezer.tick({
          dir: s.project,
          rev: () => s.ws.revision().rev,
          playing: () => link.playing,
          reload: () => reloadActiveProject(s.ws),
        }),
      );
    }
  }, AUTO_FREEZE_EVERY_MS);
  autoFreezeTimer.unref();
}

/** Leave `module` live while somebody edits it, or let it freeze again — the graph's knobs ask. */
export function thawAutoFreeze(
  ws: Workspace,
  module: string,
  on: boolean,
): void {
  const p = ws.activeProjectPath();
  if (!p) return;
  autoFreezer.thaw(p, module, on);
  reloadActiveProject(ws);
}

/** A document a BROWSER built, per session, in force until that session's project changes under it — docs/activeProject.md. */
const clientDocs = new Map<string, ProjectDoc>();

/** Forget the browser-supplied document of `ws`' session — a different project is being served there. */
function dropClientProject(ws: Workspace): void {
  clientDocs.delete(sessionOf(ws));
}

/** The engine, by address, each session's project last went out to: another one is a load of its own (docs/engineLoad.md). */
const sentTo = new Map<string, string>();

/** Send a document in `ws`' session once its files are on the engine's machine — docs/engineSync.md. */
function sendDoc(ws: Workspace, doc: ProjectDoc): void {
  const session = sessionOf(ws);
  sendWhenSynced(session, doc, namedSongFiles, (d) => {
    // The dry run is playing a silenced copy; its restore sends the latest document — docs/engineLoad.md.
    if (isWarming(session)) return;
    const c = ensureEngine(ws);
    // On no engine at all: whichever is bound next holds nothing of it, whatever its address.
    if (!c) {
      sentTo.delete(session);
      return endLoad(session);
    }
    const url = selectedEngine();
    if (url && sentTo.get(session) !== url && loadPhase(session) === null)
      beginLoad(session);
    // A LOAD naming an external plugin waits for the engine's scan, then goes compiled anew (engineScanGate.ts).
    const project = served.get(session)?.project;
    if (
      project &&
      (loadPhase(session) === "copying" || loadPhase(session) === "scanning") &&
      scanHolds(
        session,
        project,
        () => ws.revision().rev,
        c,
        () => {
          ws.invalidateProjectDoc();
          resendServed(ws);
        },
      )
    )
      return;
    if (url) sentTo.set(session, url);
    // An armed take hears the lane around its punch, never under it (takeArm.ts); an auditioned timeline plays alone (timelinePlay.ts).
    c.sendProject(withTimelinePlay(session, withTakeHole(session, d)));
    void warmUp(session, d, warmDeps(ws, c));
  });
}

/** Send `ws` its document again — the one a client sent, else the compiled one — as the dry run's restore does. */
function resendServed(ws: Workspace): void {
  const session = sessionOf(ws);
  const doc = clientDocs.get(session);
  const project = served.get(session)?.project;
  if (doc) sendDoc(ws, doc);
  // The compile as it stands: the revision token already moves with every input, the engine's scan included.
  else if (project) pushProject(ws, project);
}

/** The dry run's hands on one session's engine link. */
export function warmDeps(ws: Workspace, c: EngineClient): WarmDeps {
  const session = sessionOf(ws);
  // Whether record was on when the dry run began: rolling would RECORD, count-in, take and all.
  let recordWasOn = false;
  return {
    engine: c,
    current: () => links.get(session)?.client === c,
    // An engine SELECTED, not a link open: right after a switch the link is dropped and redialled by the next poll.
    hasEngine: hasSelectedEngine,
    sendProject: (d) => c.sendProject(d),
    play: () => {
      recordWasOn = links.get(session)?.recordEnabled ?? false;
      // Off whatever the link read: a press younger than the last state frame is on at the engine (docs/engineLoad.md).
      c.setRecordEnabled(false);
      c.transport("play");
    },
    stopAndRewind: () => {
      c.transport("stop");
      c.transport("rewind");
      if (recordWasOn) c.setRecordEnabled(true);
    },
    loaded: async () =>
      (await awaitSessions(c))?.some((x) => x.id === session && x.loaded),
    restore: () => {
      const doc = clientDocs.get(session);
      const project = served.get(session)?.project;
      if (doc) sendDoc(ws, doc);
      else if (project) pushProject(ws, project);
    },
    log: (msg) => console.warn(`   ⚠ ${basename(ws.root)}: ${msg}`),
  };
}

/** The engine's plugin scan `ws`' load waits for, or the one it went on without, for the /workspace poll. */
export function engineScanStateOf(
  ws: Workspace | null,
): EngineScanState | null {
  return engineScanOf(sessionOf(ws));
}

/** The copy holding `ws`' document back, or the last one that failed, for the /workspace poll. */
export function engineSyncOf(ws: Workspace | null): EngineSyncState | null {
  return engineSyncState(sessionOf(ws));
}

/** Where `ws`' opened project stands on its way to playable, for the gate; a failed copy ends the wait. */
export function engineLoadOf(ws: Workspace | null): EngineLoadPhase | null {
  const session = sessionOf(ws);
  const sync = engineSyncState(session);
  if (sync && (sync.failed || sync.error)) {
    endLoad(session);
    return null;
  }
  const url = selectedEngine();
  const project = ws?.activeProjectPath();
  const serving = !!ws && !!project && served.get(session)?.project === project;
  // No engine bound: the project is on none, so Play waits — the page's own socket may be up already.
  if (serving && !url) {
    sentTo.delete(session);
    return loadPhase(session) ?? "copying";
  }
  // An engine selected after the project opened holds nothing yet, and a Play it answered now would be lost to the build.
  if (
    ws &&
    url &&
    serving &&
    loadPhase(session) === null &&
    sentTo.get(session) !== url
  ) {
    sentTo.set(session, url);
    beginLoad(session);
    try {
      resendServed(ws);
    } catch {
      // A project that does not compile: the editor shows the error, so nothing is left to wait for.
      endLoad(session);
    }
  }
  return loadPhase(session);
}

/** Forget a failed copy and recompile and send the project, which copies again — the dialog's Reload. */
export function retryEngineSync(ws: Workspace): void {
  forgetSyncFailure(sessionOf(ws));
  reloadActiveProject(ws);
}

/** Play a document a browser built, through the service's own link — see docs/activeProject.md. */
export function applyClientProject(ws: Workspace, doc: ProjectDoc): void {
  clientDocs.set(sessionOf(ws), doc);
  sendDoc(ws, doc);
}

/** Compile `dir` and send it — NOT while a browser holds the document, or the surface blinks empty (docs/activeProject.md). */
function pushProject(ws: Workspace, dir: string): void {
  if (!clientDocs.has(sessionOf(ws))) sendDoc(ws, ws.cachedProjectDoc(dir));
}

function enginePlugins(
  ws: Workspace,
  fire: (c: EngineClient) => void,
  out: CommandOutput,
  timeoutMs: number,
  rescan: boolean,
): Promise<void> {
  const c = ensureEngine(ws);
  if (!c || !isReady(ws)) {
    out.push(NO_ENGINE);
    return Promise.resolve();
  }
  return new Promise((res) => {
    const t = setTimeout(res, timeoutMs);
    c.once("plugins", (plugins: PluginInfo[]) => {
      clearTimeout(t);
      if (rescan) out.push(`scanned ${plugins.length} plugin(s)`);
      else if (!plugins.length)
        out.push("no plugins cached — run: k7 engine scan");
      else
        for (const p of plugins)
          out.push(
            `  ${p.role === "instrument" ? "[inst]" : p.role === "midiEffect" ? "[midi]" : "     "} ${p.name}  [${p.format}]  ${p.manufacturer}`,
          );
      res();
    });
    fire(c);
  });
}

function safeBaseModules(dir: string): string[] {
  try {
    return listBaseModules(dir);
  } catch {
    return [];
  }
}

/** Compile `p` and push it to `ws`' session, noting it FIRST even if the compile throws. */
function sendActiveProject(ws: Workspace, p: string): void {
  noteServed(ws, p);
  try {
    pushProject(ws, p);
  } catch (e) {
    // Nothing reaches the engine, so nothing is left to wait for: the editor shows the compile error.
    endLoad(sessionOf(ws));
    // Not fatal — /project-doc and /graph surface it — but never silent, see docs/activeProject.md.
    console.error(
      `   ✗ could not send ${basename(p)} to the engine: ${(e as Error).message}`,
    );
  }
}

/** One pattern watch per SESSION, as its close: the bench beside a song must not silence the song's — docs/activeProject.md. */
const strudelWatchers = new Map<string, () => void>();
/** How long a burst of events on one save is let settle into one recompile. */
const PATTERN_SETTLE_MS = 50;
// Close a session's pattern watch; a fallback `fs.watch` lets go of its handle here, before any rename.
async function closeStrudelWatcher(session: string): Promise<void> {
  const close = strudelWatchers.get(session);
  if (!close) return;
  strudelWatchers.delete(session);
  close();
}
/** Whether a path under the project (slash-separated) is a pattern the watch carries — docs/activeProject.md. */
export function carriesPattern(rel: string): boolean {
  return rel.endsWith(".strudel") && !rel.split("/").some(skip);
}

function watchStrudel(ws: Workspace, dir: string | null): void {
  const session = sessionOf(ws);
  // Switching projects: the old watch closes first.
  void closeStrudelWatcher(session);
  if (!dir) return;
  let timer: NodeJS.Timeout | null = null;
  const onChange = (rel: string): void => {
    // A lane's pattern is IN the document, so its save is a recompile; the engine applies it in place.
    if (!carriesPattern(rel) || timer) return;
    if (!patternFiles(dir).includes(resolve(dir, ...rel.split("/")))) return;
    timer = setTimeout(() => {
      timer = null;
      ws.invalidateProjectDoc();
      guard(
        "pattern save",
        Promise.resolve().then(() => pushProject(ws, dir)),
      );
    }, PATTERN_SETTLE_MS);
  };
  const stopTimer = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  // Live sync's capture already hears every path in the workspace: no second watcher on the project.
  const feed = ws.liveCapture;
  const under = feed ? relative(feed.root, dir).split(sep).join("/") : null;
  if (feed && under !== null && !climbsOut(under)) {
    const prefix = under ? `${under}/` : "";
    const unsubscribe = feed.onChange((rel) => {
      if (rel.startsWith(prefix)) onChange(rel.slice(prefix.length));
    });
    strudelWatchers.set(session, () => {
      unsubscribe();
      stopTimer();
    });
    return;
  }
  // Live sync off: one recursive watch on the project, closed before anything renames it.
  try {
    const handle = watch(
      dir,
      { recursive: true, persistent: false },
      (_e, name) => {
        if (name) onChange(String(name).split(sep).join("/"));
      },
    );
    // A watch that dies here stops feeding pattern edits for ever, and this line is all there is.
    handle.on("error", (err: unknown) =>
      console.error(
        `   ✗ strudel watcher: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    strudelWatchers.set(session, () => {
      handle.close();
      stopTimer();
    });
  } catch (e) {
    console.error(`   ✗ strudel watcher: ${(e as Error).message}`);
  }
}

// Point the engine at the active project and send it; switching to a DIFFERENT project flushes it first.
export function startEngineForActive(ws: Workspace): void {
  const p = ws.activeProjectPath();
  if (!p) return;
  // What THIS session was serving: another person opening their song is not a switch here.
  const before = served.get(sessionOf(ws))?.project ?? null;
  const switching = before !== null && p !== before;
  // A project NEWLY in this session is copied, applied and dry-run before the gate lets go — docs/engineLoad.md.
  if (p !== before) beginLoad(sessionOf(ws));
  watchStrudel(ws, p);
  // …and the module folders, for a different consumer — see docs/activeProject.md.
  watchModuleFolders(p, ws.liveCapture);
  if (switching) {
    flushProject(ws);
    // A document built for the project we are LEAVING must not survive into this one, nor its audition.
    dropClientProject(ws);
    setTimelinePlay(sessionOf(ws), null);
    // …nor its module watch, or every project ever opened would keep four directory handles.
    forgetModuleWatch(before);
  }
  sendActiveProject(ws, p);
}

/** Close the module watch on `project`, unless somebody else is still served it — docs/activeProject.md. */
function forgetModuleWatch(project: string): void {
  for (const s of served.values()) if (s.project === project) return;
  closeModuleWatch(project);
}

// Recompile from disk and push — the explicit reload an out-of-band edit needs, since write() only invalidates.
export function reloadActiveProject(ws: Workspace): void {
  // An explicit reload outranks a browser's document — see docs/activeProject.md.
  dropClientProject(ws);
  ws.invalidateProjectDoc();
  startEngineForActive(ws);
}

/** The 2 s poll's engine upkeep, asked of THIS workspace's session — see docs/activeProject.md. */
export function prewarmEngineForActive(
  ws: Workspace,
  now: number = Date.now(),
): void {
  const s = served.get(sessionOf(ws));
  if (!s) {
    startEngineForActive(ws);
    return;
  }
  // Another project in the same workspace: reconciling would re-assert the one being left.
  if (ws.activeProjectPath() !== s.project) return;
  void reconcileEngine(ws, s, now, sendActiveProject).catch((e: unknown) =>
    console.error(`   ✗ engine reconcile failed: ${(e as Error).message}`),
  );
}

/** Unload ONE workspace's session — stop, flush and forget it. `null` is the bare session. */
export async function unloadEngine(ws: Workspace | null): Promise<void> {
  const leaving = sessionOf(ws);
  // Read BEFORE `served.delete` below: it is the only record of which folder was being served.
  const leftProject = served.get(leaving)?.project ?? null;
  // Nothing will be served, so nothing is on its way; a dry run's stop goes out ahead of the flush.
  forgetScanWait(leaving);
  endLoad(leaving);
  const e = ensureEngine(ws);
  if (e) {
    try {
      e.transport("stop");
      flushProject(ws);
    } catch {
      /* engine offline — nothing to unload */
    }
  }
  served.delete(leaving);
  sentTo.delete(leaving);
  // The browser's document belongs to its session, so only this one's goes.
  clientDocs.delete(leaving);
  // The one place that means "this workspace is DONE", so the SESSION goes, not just the socket.
  dropLink(leaving, { tellEngine: true });
  // Await the watcher close: a caller about to rename or delete must not race the OS releasing the handle.
  await closeStrudelWatcher(leaving);
  // The module watch on THIS workspace's project, for the same reason — `fs.watch` closes synchronously.
  if (leftProject) forgetModuleWatch(leftProject);
}

/** Unload whichever sessions serve a project AT or UNDER `abs` — a project, or a whole workspace (docs/workspaces.md). */
export async function unloadEngineIfServing(abs: string): Promise<boolean> {
  const holders = [...served.values()].filter((s) => {
    const rel = relative(abs, s.project);
    return rel === "" || !climbsOut(rel);
  });
  for (const s of holders) await unloadEngine(s.ws);
  return holders.length > 0;
}

/** Audition a file over [start, start+length) seconds, in the REQUEST's session — docs/activeProject.md. */
export function enginePreview(
  ws: Workspace | null,
  file: string,
  start: number,
  length: number,
): void {
  ensureEngine(ws)?.preview(file, start, length);
}

/** The take most recently turned into a clip, per SESSION, for the /workspace poll to pick up. */
export type TakeRef = { clip: string; track: string };
const lastTakes = new Map<string, TakeRef>();
export const takeJustRecorded = (ws: Workspace | null): TakeRef | null =>
  lastTakes.get(sessionOf(ws)) ?? null;

/** Turn a finished take into a clip, in the project the recording SESSION was SENT — docs/activeProject.md. */
function onRecorded(session: string, take: RecordedTake): void {
  const s = served.get(session);
  if (!s) {
    // Never silent: the audio is on disk and only this message says where to look for it.
    console.error(
      `[rec] ${take.track}: recorded ${take.file}, but session ${session} is serving no project here — the clip was NOT added to any track`,
    );
    return;
  }
  const { ws, project } = s;
  // A take recorded in the takes view goes INTO the event it was armed on, not onto the lane (takeArm.ts).
  const arm = takeArmOf(session);
  try {
    const id =
      arm && arm.track === take.track
        ? addTakeToEvent(project, ws.cachedProjectDoc(project), take, arm)
        : addTakeToTrack(project, ws.cachedProjectDoc(project), take);
    ws.invalidateProjectDoc();
    pushProject(ws, project);
    lastTakes.set(session, { clip: id, track: take.track });
    console.log(`[rec] ${take.track}: added clip ${id}`);
  } catch (e) {
    console.error(
      `[rec] ${take.track}: recorded ${take.file} but could not add it to the track: ${(e as Error).message}`,
    );
  }
}

/** A reload a verb asked for, held until the run's last write — see docs/activeProject.md. */
interface HeldPush {
  dir: string | null;
}

/** Compile and send the reload `held` names, if any, reporting a failure the way `reload` always has. */
function flushPush(ws: Workspace, out: CommandOutput, held?: HeldPush): void {
  const dir = held?.dir;
  if (!held || !dir) return;
  held.dir = null;
  try {
    pushProject(ws, dir);
  } catch (e) {
    out.push(`reload error: ${(e as Error).message}`);
  }
}

function makeHost(
  ws: Workspace,
  out: CommandOutput,
  userEmail?: string,
  snapshot?: (absPath: string) => void,
  // Where the verbs act when it is NOT the open project — absolute, resolved and checked by the caller.
  at?: string,
  // Given by a run that flushes it, so the reload's compile shares the graph's module stamp.
  held?: HeldPush,
): CommandHost {
  const dir = at ?? ws.activeProjectPath();
  const requireDir = (): string => {
    if (!dir) throw new Error(NO_PROJECT);
    return dir;
  };
  // Every engine call goes out AFTER the document a reload held back, as it did when reload sent it at once.
  const engine = (): EngineClient | undefined => {
    flushPush(ws, out, held);
    return ensureEngine(ws);
  };
  // The module vocabulary costs ~1 s and only `create module` needs it — hence a memoised getter.
  let baseModuleCache: string[] | undefined;
  return {
    songPath: dir ?? "",
    project: () => ws.cachedProjectDoc(requireDir()),
    get baseModules(): string[] {
      return (baseModuleCache ??= dir ? safeBaseModules(dir) : []);
    },
    log: (lines) => out.push(...lines),
    // The same lines, and one verdict on the whole reply — see docs/activeProject.md.
    refuse: (lines) => {
      out.refused = true;
      out.push(...lines);
    },
    // The take's bytes are on THIS machine — the engine wrote them — so this host is the only
    // one that can answer `node record save`. The record directory is the document's, which is
    // what the path is checked against (recorderSave.ts).
    saveTake: async (file, label) => {
      const dir = ws.cachedProjectDoc(requireDir()).recordDir;
      const res = await saveTake({ recordDir: dir, file, label });
      return res.path;
    },
    reload: () => {
      try {
        ws.invalidateProjectDoc();
        // Held, when the run will flush it, so its compile and the graph walk the module folders once.
        if (held) held.dir = requireDir();
        else pushProject(ws, requireDir());
      } catch (e) {
        out.push(`reload error: ${(e as Error).message}`);
      }
    },
    // Every engine call below names `ws`: defaulting sent transport and arm to the empty room.
    transport: (a: TransportAction) => engine()?.transport(a),
    // A link still dialling is waited for, not refused: the desktop re-dials it on every tab switch (engineArm.ts).
    arm: (track, armed) => {
      const c = engine();
      if (!c) {
        out.push(NO_ENGINE);
        return Promise.resolve(undefined);
      }
      return armOnceOpen(c, track, out, () => isReady(ws), armed);
    },
    // A whole document replaces a held reload rather than following it, or the older one would land last.
    applyProject: (p) => {
      if (held) held.dir = null;
      ws.setCachedProjectDoc(requireDir(), p);
      sendDoc(ws, p);
    },
    sendProject: (p) => {
      if (held) held.dir = null;
      sendDoc(ws, p);
    },
    // Say so when there is nothing to ask, or "opening…" reads as a dead button.
    showNativePluginUI: (id) => {
      const e = engine();
      if (!e) out.push(NO_ENGINE);
      else e.showNativePluginUI(id);
    },
    listPlugins: (filter) => {
      flushPush(ws, out, held);
      return enginePlugins(ws, (c) => c.listPlugins(filter), out, 4000, false);
    },
    rescanPlugins: (force) => {
      flushPush(ws, out, held);
      return enginePlugins(ws, (c) => c.rescanPlugins(force), out, 60000, true);
    },
    // Which chain this machine separates with, read per request so `system stems` needs no telling.
    get stemsChain(): string | undefined {
      return loadPreferences().stemsChain;
    },
    // …and the one that gives it without its voice, read the same way.
    get instrumentalChain(): string | undefined {
      return loadPreferences().instrumentalChain;
    },
    // Every render a verb makes — freeze, consolidate, process — through this service's renderer (docs/renderers.md).
    get renderer() {
      return serviceRenderer() ?? undefined;
    },
    // The takes view: where this session's next take goes, the document re-sent with its hole (takeArm.ts).
    takeArm: (arm) => {
      setTakeArm(sessionOf(ws), arm);
      resendServed(ws);
      return true;
    },
    timelinePlay: (id) => {
      setTimelinePlay(sessionOf(ws), id);
      resendServed(ws);
      return true;
    },
    ...engineQueries(ws, engine),
    ...serviceMembers(ws, userEmail),
    // A process backs up each render here before overwriting it, feeding the recordChange journal.
    snapshot,
  };
}

/** Verbs that need no active project — a copy of `commands.yaml` names, see docs/activeProject.md. */
const GLOBAL_COMMAND = /^(system channel|playlist|library)\b/;

/** The lines a command produced, plus whether it REFUSED — see docs/activeProject.md. */
export type CommandOutput = string[] & { refused?: boolean };

/** What a run answers: the lines, the revision either side, and what it wrote — docs/activeProject.md. */
export interface WebCommandRun {
  output: CommandOutput;
  before: string;
  after: string;
  /** …and which files it wrote, from the same diff. `null` = not known; see `Recorded`. */
  files: ChangedFile[] | null;
  /** The graph after a WRITING command, when asked for; built beside the held reload. */
  graph?: WebGraph;
  /** `performance.now()` when the verb finished — what is after it is the reload and the graph. */
  ranAt: number;
}

export async function runWebCommand(
  ws: Workspace,
  line: string,
  userEmail?: string,
  // The folder the verbs act on when it is not the open project. Absolute; the route checks it.
  at?: string,
  // Build the graph a writing command's reply carries, and say how its writes are journalled.
  opts: { graph?: boolean; journal?: JournalMode } = {},
): Promise<WebCommandRun> {
  const out: CommandOutput = [];
  const held: HeldPush = { dir: null };
  // A refusal too, and the first one a caller meets — see docs/activeProject.md.
  if (!at && !ws.activeProjectPath() && !GLOBAL_COMMAND.test(line.trim())) {
    const no: CommandOutput = [NO_PROJECT];
    no.refused = true;
    // Nothing ran: the two instants are one, and `[]` is the truth where `null` would say "re-ask".
    const rev = ws.revision().rev;
    return {
      output: no,
      before: rev,
      after: rev,
      files: [],
      ranAt: performance.now(),
    };
  }
  // Journal whatever files the command changes, so Ctrl+Z can undo it (a no-op when nothing changed).
  const { before, after, files } = await ws.recordChange(
    line,
    async (snapshot) => {
      try {
        await runCommand(
          line,
          makeHost(ws, out, userEmail, snapshot, at, held),
          SURFACE,
        );
      } catch (e) {
        out.push(`error: ${(e as Error).message}`);
      }
    },
    opts.journal,
  );
  // A verb writes beside the service, so the stamp must hear of it BEFORE the graph is built — docs/moduleWatch.md.
  if (after !== before) moduleFoldersMoved();
  const ranAt = performance.now();
  // Past the last write: the held reload and the graph read ONE module stamp, at the token the run ended on.
  const settle = (): WebGraph | undefined =>
    ws.withRevision(() => {
      flushPush(ws, out, held);
      return after !== before && opts.graph ? ws.graphDoc() : undefined;
    }, after);
  const project = ws.activeProjectPath();
  const graph = project ? withModuleStamp(project, settle) : settle();
  // With no graph the reload is the verb's own cost, so `ran=` carries it rather than nothing.
  return {
    output: out,
    before,
    after,
    files,
    graph,
    ranAt: opts.graph ? ranAt : performance.now(),
  };
}

/** `/complete`'s answer: bare lines, and with `labelled` an object for a labelled one only — docs/completions.md. */
export function webCompletions(
  ws: Workspace,
  line: string,
  labelled = false,
): (string | CompletionItem)[] {
  try {
    return completionItems(line, makeHost(ws, []), SURFACE).map((c) =>
      labelled && c.label ? c : c.line,
    );
  } catch {
    return [];
  }
}

export function webCommandList(): CommandInfo[] {
  return loadCommandSpecs()
    .filter((c) => c.surfaces.includes(SURFACE))
    .map((c) => ({
      command: c.command,
      help: c.help,
      readable: c.readable,
      // Which right-clicks may offer it — absent, and every menu its arguments fit may.
      menu: c.menu,
      // …and whether it asks first.
      confirm: c.confirm,
      // The trailing user args in order, each with its class and the PROVIDER it completes from.
      args:
        c.args?.map((a) => ({
          name: a.name,
          kind: argClass(a),
          provider: a.complete,
          hint: argHint(a),
          optional: a.optional,
        })) ?? [],
    }));
}

// The sessions call back into the project work here — engineSessions.ts.
linkHooks.resend = sendActiveProject;
linkHooks.recorded = onRecorded;
linkHooks.dialled = startAutoFreeze;
