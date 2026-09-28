// engineLink.ts — run the brain's command layer and drive the LOCAL C++ engine, dialled
// once at boot. One engine, but one SESSION per workspace owner: `served` says what this
// service sent to each of them, so a re-send or a take resolves its workspace explicitly.
// The one singleton is the document a browser hands over — see docs/activeProject.md.

import type { Stats } from "node:fs";
import { basename, relative, resolve } from "node:path";
import {
  argClass,
  argHint,
  completions,
  loadCommandSpecs,
  runCommand,
} from "@studio/commands/commandSpec";
import type { CommandHost, TransportAction } from "@studio/commands/commands";
import type { GitEnv } from "@studio/commands/git";
import {
  type AudioDeviceInfo,
  EngineClient,
  type PluginInfo,
  type PluginParamInfo,
  type RecordedTake,
} from "@studio/engine-client/engineClient";
import type { SessionInfo } from "@studio/engine-client/engineControl";
import { SESSIONS, sessionFor } from "@studio/engine-protocol/sessions";
import { patternFiles } from "@studio/song/enginePattern";
import { listBaseModules } from "@studio/song/loader";
import { loadPreferences } from "@studio/song/preferences";
import type { ProjectDoc } from "@studio/song/project";
import {
  separateJob,
  startSeparate,
} from "@studio/stem-separation/separateJobs";
import { addTakeToTrack } from "@studio/take-render/recordTake";
import {
  type ChangedFile,
  type CommandInfo,
  ENGINE_RECONNECT_MIN_MS,
} from "@studio/web-protocol";
import chokidar from "chokidar";
import { autoFreezer } from "./autoFreezeJobs.ts";
import { guard } from "./background.ts";
import { BENCH_WORKSPACE } from "./bench.ts";
import { askBoundMachine } from "./boundMachine.ts";
import { syncLibraries } from "./libraries.ts";
import {
  closeModuleWatch,
  moduleFoldersMoved,
  watchModuleFolders,
} from "./moduleWatch.ts";
import { saveTake } from "./recorderSave.ts";
import { rootDir, slugify } from "./slug.ts";
import { sshCommand } from "./sshKeys.ts";
import { skip, type Workspace } from "./workspace.ts";

const SURFACE = "cli" as const; // the one surface the shared registry defines
const NO_PROJECT =
  "no active project — select a project in the workspace first";
const NO_ENGINE = "engine offline — is the C++ engine running on this machine?";

/** How often a waiting `clip process` asks the separation registry — slow on purpose. */
const COLD_POLL_MS = 1000;

/** One socket per SESSION, all to the same engine. Keyed by session id. */
interface Link {
  client: EngineClient;
  ready: boolean;
  /** When something last asked for it, so an abandoned one can be reaped — see pruneIdleLinks. */
  lastUsed: number;
  /** Consecutive failed dials, reset by a socket that opened. Drives the reconnect backoff. */
  attempt: number;
  /** The transport, off the engine's state frames: an automatic freeze waits for it to stop. */
  playing: boolean;
}
const links = new Map<string, Link>();

/** How long a link may go untouched before it is dropped. Minutes, not seconds. */
const LINK_IDLE_MS = 5 * 60_000;

/** The reconnect backoff's ceiling HERE, deliberately not the browser's — see docs/activeProject.md. */
const LOCAL_RECONNECT_MAX_MS = 4000;
let selectedEngineUrl: string | undefined;

/** What this service last SENT to one session, keyed by session — see docs/activeProject.md. */
interface Served {
  ws: Workspace;
  /** The project path we sent — what the ENGINE holds, which a take belongs to. */
  project: string;
  /** The reconcile throttle, per session: two of them must not starve each other. */
  lastReconcile: number;
  reconciling: boolean;
  /** Consecutive re-sends the engine did not take — a live socket can still be deaf, docs/activeProject.md. */
  resends: number;
}
const served = new Map<string, Served>();

/** Note that `project` is what this session now holds, keeping any reconcile state in flight. */
function noteServed(ws: Workspace, project: string): void {
  const s = served.get(sessionOf(ws));
  if (s) {
    s.ws = ws;
    s.project = project;
    return;
  }
  served.set(sessionOf(ws), {
    ws,
    project,
    lastReconcile: 0,
    reconciling: false,
    resends: 0,
  });
}

/** Whose workspaces this machine holds. One root means one person — docs/activeProject.md. */
let owner = "";

/** Told by the request that carries it; the path no longer says, since the slug left the tree. */
export function noteOwner(email: string): void {
  if (email) owner = email;
}

/** Which session this machine's projects belong to — through `sessionFor`, so the browser's half cannot differ. */
export function sessionOf(ws: { root: string } | null): string {
  if (!ws || !owner) return SESSIONS.st0;
  const rel = relative(rootDir(), ws.root);
  // Outside the root is a workspace this service does not own — the bare session, as before.
  if (!rel || rel.startsWith("..")) return SESSIONS.st0;
  // The bench's workspace plays in a session of its own, beside the song — apps/pl8/docs/banc.md.
  if (rel.split(/[\\/]/)[0] === BENCH_WORKSPACE)
    return sessionFor(SESSIONS.bench, owner);
  return sessionFor(SESSIONS.st0, owner);
}

/** The note above read from outside, in ADDRESSES rather than paths — see docs/activeProject.md. */
export function servedProject(
  userEmail: string,
): { workspace: string; path: string } | null {
  const slug = slugify(userEmail);
  const s =
    served.get(`${SESSIONS.st0}:${slug}`) ?? served.get(SESSIONS.st0) ?? null;
  if (!s) return null;
  const ws = relative(rootDir(), s.ws.root).split(/[\\/]/);
  // Anything but a single `<workspace>` is one this machine cannot name in an address.
  if (!ws[0] || ws[0].startsWith("..")) return null;
  const rel = relative(s.ws.root, s.project).replace(/\\/g, "/");
  // `.` for a lone-project clone, which is how the surface listing spells it too.
  return { workspace: ws[0], path: rel === "" ? "." : rel };
}

function wireEngine(session: string, e: EngineClient): void {
  e.on("open", () => {
    const l = links.get(session);
    if (l) {
      l.ready = true;
      l.attempt = 0; // a socket that opened earns the next outage a fresh, short first wait
    }
    try {
      const prefs = loadPreferences();
      if (prefs.audioDevice)
        e.setAudioDevice(prefs.audioDevice.name, prefs.audioDevice.type);
      // …then how its inputs are GROUPED, and that order is load-bearing — docs/activeProject.md.
      for (const first of prefs.inputPairs) e.setInputStereo(first, true);
    } catch {
      /* no/invalid preferences — keep the system default */
    }
    // Re-send the project THIS session was serving — a fresh socket may be a fresh ENGINE.
    const s = served.get(session);
    if (s) sendActiveProject(s.ws, s.project);
  });
  // Doubled and jittered, but capped SHORT — see docs/activeProject.md.
  e.on("close", () => {
    const l = links.get(session);
    if (l) l.ready = false;
    const step = Math.min(
      LOCAL_RECONNECT_MAX_MS,
      ENGINE_RECONNECT_MIN_MS * 2 ** (l?.attempt ?? 0),
    );
    if (l) l.attempt++;
    setTimeout(
      () => {
        if (links.get(session)?.client === e) e.connect();
      },
      step / 2 + Math.random() * (step / 2),
    );
  });
  // Not silent: with no trace of a refused dial, "off" and "wedged" look identical.
  e.on("wserror", (err: Error) =>
    console.error(`   ✗ engine socket ${session}: ${err.message}`),
  );
  // The session is carried by the SOCKET, not the frame, so it is what a take belongs to.
  e.on("recorded", (take: RecordedTake) => onRecorded(session, take));
  // Only the transport is kept: an automatic freeze swaps a track's contents, never under the playhead.
  e.on("state", (st: { playing: boolean }) => {
    const l = links.get(session);
    if (l) l.playing = st.playing;
  });
}

/** Take a link out of the map and close it, in that order — see docs/activeProject.md. */
function dropLink(session: string, { tellEngine = false } = {}): void {
  const l = links.get(session);
  if (!l) return;
  links.delete(session);
  try {
    if (tellEngine) l.client.dropSession(session);
    l.client.close();
  } catch {
    /* already closed */
  }
}

/** Close links nothing has used for LINK_IDLE_MS — see docs/activeProject.md. `now` is for the test. */
export function pruneIdleLinks(now: number = Date.now()): string[] {
  const dropped: string[] = [];
  for (const [session, l] of links) {
    // Never a session holding a project: it is idle between commands by nature.
    if (served.has(session)) continue;
    if (now - l.lastUsed < LINK_IDLE_MS) continue;
    dropLink(session);
    dropped.push(session);
  }
  return dropped;
}

// Dial the local engine; the sockets themselves open lazily, per session, on first use.
export function setSelectedEngine(url: string): void {
  if (url === selectedEngineUrl && links.size) return;
  selectedEngineUrl = url;
  // A different engine invalidates every session's socket, not just the current one.
  for (const session of [...links.keys()]) dropLink(session);
}

/** Drive no engine at all — a hosted file service between two bindings, packages/file-hub/docs/fileHub.md. */
export function clearSelectedEngine(): void {
  selectedEngineUrl = undefined;
  for (const session of [...links.keys()]) dropLink(session);
}

/** The socket for one session, opened on first use — the workspace is REQUIRED, docs/activeProject.md. */
export function ensureEngine(ws: Workspace | null): EngineClient | undefined {
  if (!selectedEngineUrl) return undefined;
  const session = sessionOf(ws);
  const existing = links.get(session);
  if (existing) {
    existing.lastUsed = Date.now(); // every use, so pruneIdleLinks only ever sees the abandoned
    return existing.client;
  }
  // The other half of st0's session, and deliberately NOT a driver — see docs/activeProject.md.
  const client = new EngineClient(selectedEngineUrl, session);
  links.set(session, {
    client,
    ready: false,
    lastUsed: Date.now(),
    attempt: 0,
    playing: false,
  });
  wireEngine(session, client);
  client.connect();
  startAutoFreeze();
  return client;
}

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
          gitEnv: webGitEnv(owner || undefined),
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

/** Whether this session's socket is open. A fresh one is not, and says so. */
function isReady(ws: Workspace | null): boolean {
  return links.get(sessionOf(ws))?.ready ?? false;
}

/** A document a BROWSER built, per session, in force until that session's project changes under it — docs/activeProject.md. */
const clientDocs = new Map<string, ProjectDoc>();

/** Forget the browser-supplied document of `ws`' session — a different project is being served there. */
function dropClientProject(ws: Workspace): void {
  clientDocs.delete(sessionOf(ws));
}

/** Send a document in `ws`' session — the engine diffs it against what that session holds. */
function sendDoc(ws: Workspace, doc: ProjectDoc): void {
  ensureEngine(ws)?.sendProject(doc);
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
        out.push("no plugins cached — run: st0 engine scan");
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

/** How long the engine gets to LOAD a plugin and list its parameters — see docs/activeProject.md. */
export const PLUGIN_PARAMS_TIMEOUT_MS = 20_000;

/** The slice of EngineClient this needs, so the wait can be tested without a socket. */
export interface PluginParamListingClient {
  on(event: "pluginParamList", fn: (p: PluginParamFrame) => void): unknown;
  off(event: "pluginParamList", fn: (p: PluginParamFrame) => void): unknown;
  listPluginParams(format: string, id: string): void;
}
interface PluginParamFrame {
  format: string;
  id: string;
  /** Whether the machine could LOAD it — see `PluginParamAnswer.found`. */
  found?: boolean;
  params: PluginParamInfo[];
}

/** What one plugin answered — THREE outcomes, not two. See docs/activeProject.md. */
export interface PluginParamAnswer {
  found: boolean;
  params: PluginParamInfo[];
}

/** Ask what one plugin's parameters are, MATCHED ON THE ID — `undefined` = silence, docs/activeProject.md. */
export function awaitPluginParams(
  c: PluginParamListingClient,
  format: string,
  id: string,
  timeoutMs: number = PLUGIN_PARAMS_TIMEOUT_MS,
): Promise<PluginParamAnswer | undefined> {
  return new Promise((res) => {
    const done = (v?: PluginParamAnswer): void => {
      clearTimeout(timer);
      c.off("pluginParamList", onList);
      res(v);
    };
    const onList = (p: PluginParamFrame): void => {
      if (p.id !== id) return; // another surface's question, not the answer to this one
      // An engine too old to send the flag loaded SOMETHING to answer at all, so absent reads as true.
      done({ found: p.found !== false, params: p.params });
    };
    const timer = setTimeout(() => done(undefined), timeoutMs);
    c.on("pluginParamList", onList);
    c.listPluginParams(format, id);
  });
}

/** …asked of THIS machine's engine, on the bare session — see docs/activeProject.md. */
export async function pluginParams(
  format: string,
  id: string,
): Promise<PluginParamAnswer | undefined> {
  const c = ensureEngine(null);
  // No `isReady` check here, deliberately: `send` buffers, and that is what makes the first click work.
  if (!c) return undefined;
  return awaitPluginParams(c, format, id);
}

/** How long the engine gets to open the window — generous, because a cold load is. See docs/activeProject.md. */
export const NATIVE_UI_TIMEOUT_MS = 30_000;

interface NativeUiFrame {
  format: string;
  id: string;
  ok: boolean;
}

/** Open the plugin's own WINDOW on an orphan instance, and AWAIT the engine — docs/activeProject.md. */
export async function showNativePluginUIOf(
  format: string,
  id: string,
): Promise<{ ok: boolean } | undefined> {
  const c = ensureEngine(null);
  if (!c) return undefined;
  return new Promise((res) => {
    const done = (v?: { ok: boolean }): void => {
      clearTimeout(timer);
      c.off("nativePluginUiOpened", onOpened);
      res(v);
    };
    const onOpened = (p: NativeUiFrame): void => {
      if (p.id !== id) return; // another surface's window, not this one
      done({ ok: p.ok });
    };
    const timer = setTimeout(() => done(undefined), NATIVE_UI_TIMEOUT_MS);
    c.on("nativePluginUiOpened", onOpened);
    c.showNativePluginUIOf(format, id);
  });
}

/** How long the engine gets to write a base. Short: nothing is LOADED here, the instance is open. */
export const PLUGIN_BASE_TIMEOUT_MS = 5_000;

interface PluginBaseFrame {
  path: string;
  ok: boolean;
}

/** Snapshot the orphan's state into `absPath`, and wait to hear whether it landed — docs/activeProject.md. */
export async function snapshotPluginBase(
  format: string,
  id: string,
  absPath: string,
): Promise<{ ok: boolean } | undefined> {
  const c = ensureEngine(null);
  if (!c) return undefined;
  return new Promise((res) => {
    const done = (v?: { ok: boolean }): void => {
      clearTimeout(timer);
      c.off("pluginBaseSaved", onSaved);
      res(v);
    };
    const onSaved = (p: PluginBaseFrame): void => {
      if (p.path !== absPath) return; // another surface's snapshot, not this one
      done({ ok: p.ok });
    };
    const timer = setTimeout(() => done(undefined), PLUGIN_BASE_TIMEOUT_MS);
    c.on("pluginBaseSaved", onSaved);
    c.snapshotPluginBase(format, id, absPath);
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
    // Not fatal — /project-doc and /graph surface it — but never silent, see docs/activeProject.md.
    console.error(
      `   ✗ could not send ${basename(p)} to the engine: ${(e as Error).message}`,
    );
  }
}

/** One pattern watcher per SESSION: the bench beside a song must not silence the song's — docs/activeProject.md. */
const strudelWatchers = new Map<string, ReturnType<typeof chokidar.watch>>();
// Close a session's strudel watcher and WAIT for the OS to release its handle — on Windows a rename needs it gone.
async function closeStrudelWatcher(session: string): Promise<void> {
  const prev = strudelWatchers.get(session);
  if (!prev) return;
  strudelWatchers.delete(session);
  try {
    await prev.close();
  } catch {
    /* already closing */
  }
}
/** What the watcher below refuses to carry: `skip()`ped folders and every non-pattern file. See docs/activeProject.md. */
export function outsideTheWatch(
  dir: string,
  p: string,
  stats?: Stats,
): boolean {
  if (p === dir) return false;
  const name = basename(p);
  if (skip(name)) return true;
  return stats?.isFile() ? !name.endsWith(".strudel") : false;
}

function watchStrudel(ws: Workspace, dir: string | null): void {
  const session = sessionOf(ws);
  // Switching projects: the old handle can close in the background.
  void closeStrudelWatcher(session);
  if (!dir) return;
  const onChange = (p: string): void => {
    // A lane's pattern is IN the document, so its save is a recompile; the engine applies it in place.
    if (!p.endsWith(".strudel") || !patternFiles(dir).includes(resolve(p)))
      return;
    ws.invalidateProjectDoc();
    guard(
      "pattern save",
      Promise.resolve().then(() => pushProject(ws, dir)),
    );
  };
  const watcher = chokidar
    .watch(dir, {
      ignoreInitial: true,
      ignored: (p: string, stats?: Stats) => outsideTheWatch(dir, p, stats),
    })
    .on("add", onChange)
    .on("change", onChange)
    .on("unlink", onChange)
    // A watcher that dies here stops feeding pattern edits for ever, and this line is all there is.
    .on("error", (err: unknown) =>
      console.error(
        `   ✗ strudel watcher: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  strudelWatchers.set(session, watcher);
}

// Point the engine at the active project and send it; switching to a DIFFERENT project flushes it first.
export function startEngineForActive(ws: Workspace): void {
  const p = ws.activeProjectPath();
  if (!p) return;
  // What THIS session was serving: another person opening their song is not a switch here.
  const before = served.get(sessionOf(ws))?.project ?? null;
  const switching = before !== null && p !== before;
  watchStrudel(ws, p);
  // …and the module folders, for a different consumer — see docs/activeProject.md.
  watchModuleFolders(p);
  if (switching) {
    ensureEngine(ws)?.flush();
    // A document built for the project we are LEAVING must not survive into this one.
    dropClientProject(ws);
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

/** How often the /workspace poll may re-ask the engine what it holds. Polled every 2 s, per tab. */
export const RECONCILE_EVERY_MS = 5_000;
/** Re-sends the engine may ignore before the socket is presumed deaf — docs/activeProject.md. */
export const RESEND_LIMIT = 3;
/** How long the engine gets to answer that question before its link is treated as dead. */
export const SESSIONS_TIMEOUT_MS = 2000;

/** The slice of EngineClient a reconcile needs — so the wait can be tested without a socket. */
export interface SessionListingClient {
  on(event: "sessions", fn: (s: SessionInfo[]) => void): unknown;
  off(event: "sessions", fn: (s: SessionInfo[]) => void): unknown;
  listSessions(): void;
}

/** Ask the engine what it is holding; `undefined` = no answer at all. See docs/activeProject.md. */
export function awaitSessions(
  c: SessionListingClient,
  timeoutMs: number = SESSIONS_TIMEOUT_MS,
): Promise<SessionInfo[] | undefined> {
  return new Promise((res) => {
    const done = (v?: SessionInfo[]): void => {
      clearTimeout(timer);
      c.off("sessions", onSessions);
      res(v);
    };
    const onSessions = (list: SessionInfo[]): void => done(list);
    const timer = setTimeout(() => done(undefined), timeoutMs);
    c.on("sessions", onSessions);
    c.listSessions();
  });
}

/** Ask whether the engine still holds what `served` claims, and put it back if not — docs/activeProject.md. */
async function reconcileEngine(
  ws: Workspace,
  s: Served,
  now: number,
): Promise<void> {
  // Throttled PER SESSION, so one person's poll cannot eat another's turn.
  if (s.reconciling || now - s.lastReconcile < RECONCILE_EVERY_MS) return;
  const serving = s.project;
  s.lastReconcile = now;
  s.reconciling = true;
  try {
    const session = sessionOf(ws);
    const c = ensureEngine(ws);
    // A link still dialling re-sends from its own `open`; asking now would time out on the wait, not the engine.
    if (!c || !isReady(ws)) return;
    const held = await awaitSessions(c);
    if (held === undefined) {
      console.error(`   ✗ engine link unresponsive — re-dialling ${session}`);
      dropLink(session);
      ensureEngine(ws); // a fresh socket, whose `open` re-sends what this session was serving
      return;
    }
    if (held.some((x) => x.id === session && x.loaded)) {
      s.resends = 0;
      return;
    }
    // A socket that answers but never takes the project is deaf, not busy — docs/activeProject.md.
    if (++s.resends > RESEND_LIMIT) {
      console.error(
        `   ✗ engine took ${RESEND_LIMIT} re-sends without holding ${basename(serving)} — re-dialling ${session}`,
      );
      s.resends = 0;
      dropLink(session);
      ensureEngine(ws); // a fresh socket, whose `open` re-sends what this session was serving
      return;
    }
    console.warn(
      `   ⚠ engine is not holding ${basename(serving)} — re-sending it (${s.resends}/${RESEND_LIMIT})`,
    );
    sendActiveProject(ws, serving);
  } finally {
    s.reconciling = false;
  }
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
  void reconcileEngine(ws, s, now).catch((e: unknown) =>
    console.error(`   ✗ engine reconcile failed: ${(e as Error).message}`),
  );
}

/** Unload ONE workspace's session — stop, flush and forget it. `null` is the bare session. */
export async function unloadEngine(ws: Workspace | null): Promise<void> {
  const leaving = sessionOf(ws);
  // Read BEFORE `served.delete` below: it is the only record of which folder was being served.
  const leftProject = served.get(leaving)?.project ?? null;
  const e = ensureEngine(ws);
  if (e) {
    try {
      e.transport("stop");
      e.flush();
    } catch {
      /* engine offline — nothing to unload */
    }
  }
  served.delete(leaving);
  // The browser's document belongs to its session, so only this one's goes.
  clientDocs.delete(leaving);
  // The one place that means "this workspace is DONE", so the SESSION goes, not just the socket.
  dropLink(leaving, { tellEngine: true });
  // Await the watcher close: a caller about to rename or delete must not race the OS releasing the handle.
  await closeStrudelWatcher(leaving);
  // The module watch on THIS workspace's project, for the same reason — `fs.watch` closes synchronously.
  if (leftProject) forgetModuleWatch(leftProject);
}

/** Unload whichever sessions are serving `projectAbs` — every one of them, not one global. */
export async function unloadEngineIfServing(
  projectAbs: string,
): Promise<boolean> {
  const holders = [...served.values()].filter((s) => s.project === projectAbs);
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
  try {
    const id = addTakeToTrack(project, ws.cachedProjectDoc(project), take);
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

// Pin git to this user's deploy key, and fail rather than hang; the global config stays for user.name.
export function webGitEnv(userEmail?: string): GitEnv {
  return userEmail
    ? { GIT_SSH_COMMAND: sshCommand(userEmail), GIT_TERMINAL_PROMPT: "0" }
    : undefined;
}

/** How long the engine gets to answer an arm. A local socket answers in single-digit ms. */
export const ARM_TIMEOUT_MS = 2000;

type ArmFrame = { track: string; armed: boolean };
/** The slice of EngineClient an arm needs — so the wait can be tested without a socket. */
export interface ArmingClient {
  on(event: "armed", fn: (a: ArmFrame) => void): unknown;
  on(event: "engineError", fn: (m: string) => void): unknown;
  off(event: "armed", fn: (a: ArmFrame) => void): unknown;
  off(event: "engineError", fn: (m: string) => void): unknown;
  arm(track: string): void;
}

/** Wait for the answer to ONE arm, matched on the TRACK; `undefined` = it did not take. See docs/activeProject.md. */
export function awaitArm(
  c: ArmingClient,
  track: string,
  out: CommandOutput,
  linkUp: () => boolean,
  timeoutMs: number = ARM_TIMEOUT_MS,
): Promise<boolean | undefined> {
  return new Promise((res) => {
    const done = (v?: boolean) => {
      clearTimeout(timer);
      c.off("armed", onArmed);
      c.off("engineError", onError);
      res(v);
    };
    const onArmed = (a: ArmFrame) => {
      if (a.track !== track) return; // another surface's arm, not the answer to this one
      done(a.armed);
    };
    const onError = (m: string) => {
      out.push(m);
      done(undefined);
    };
    // Both remaining states get named: a dropped link and a silent engine look alike otherwise.
    const timer = setTimeout(() => {
      out.push(
        linkUp()
          ? `engine did not answer the arm of "${track}" in ${timeoutMs}ms — the link is up, so check the engine log for a [rec] line`
          : `the engine link dropped while arming "${track}"`,
      );
      done(undefined);
    }, timeoutMs);
    c.on("armed", onArmed);
    c.on("engineError", onError);
    c.arm(track);
  });
}

function makeHost(
  ws: Workspace,
  out: CommandOutput,
  userEmail?: string,
  snapshot?: (absPath: string) => void,
  // Where the verbs act when it is NOT the open project — absolute, resolved and checked by the caller.
  at?: string,
): CommandHost {
  const dir = at ?? ws.activeProjectPath();
  const requireDir = (): string => {
    if (!dir) throw new Error(NO_PROJECT);
    return dir;
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
        pushProject(ws, requireDir());
      } catch (e) {
        out.push(`reload error: ${(e as Error).message}`);
      }
    },
    // Every engine call below names `ws`: defaulting sent transport and arm to the empty room.
    transport: (a: TransportAction) => ensureEngine(ws)?.transport(a),
    arm: (track) => {
      const c = ensureEngine(ws);
      if (!c || !isReady(ws)) {
        out.push(NO_ENGINE);
        return Promise.resolve(undefined);
      }
      return awaitArm(c, track, out, () => isReady(ws));
    },
    applyProject: (p) => {
      ws.setCachedProjectDoc(requireDir(), p);
      sendDoc(ws, p);
    },
    sendProject: (p) => sendDoc(ws, p),
    // Say so when there is nothing to ask, or "opening…" reads as a dead button.
    showNativePluginUI: (id) => {
      const e = ensureEngine(ws);
      if (!e) out.push(NO_ENGINE);
      else e.showNativePluginUI(id);
    },
    listPlugins: (filter) =>
      enginePlugins(ws, (c) => c.listPlugins(filter), out, 4000, false),
    rescanPlugins: (force) =>
      enginePlugins(ws, (c) => c.rescanPlugins(force), out, 60000, true),
    getPlugins: (filter) =>
      new Promise<PluginInfo[]>((res) => {
        const c = ensureEngine(ws);
        if (!c || !isReady(ws)) {
          res([]);
          return;
        }
        const t = setTimeout(() => res([]), 4000);
        c.once("plugins", (plugins: PluginInfo[]) => {
          clearTimeout(t);
          res(plugins);
        });
        c.listPlugins(filter);
      }),
    // A clip's source envelope for `event trim` — the WHOLE file, from THIS workspace's waveform machinery.
    clipEnvelope: async (clip: string) => {
      try {
        const wf = await ws.waveform(clip, 2000, true);
        return wf?.rms?.length ? { peak: wf.rms, seconds: wf.seconds } : null;
      } catch {
        return null; // no envelope yet, or a clip nothing can decode — the command says so
      }
    },
    // What the bound machine separates on: its setting, read and written THERE — stem-separation/docs/stemSplit.md.
    onnxProviders: async (set) => {
      const reply = await askBoundMachine(
        set
          ? { type: "onnx-providers", set: [...set] }
          : { type: "onnx-providers" },
        "onnx-providers",
      );
      return reply ? ((reply.providers as string[] | undefined) ?? []) : null;
    },
    // Which chain this machine separates with, read per request so `system stems` needs no telling.
    get stemsChain(): string | undefined {
      return loadPreferences().stemsChain;
    },
    // …and the one that gives it without its voice, read the same way.
    get instrumentalChain(): string | undefined {
      return loadPreferences().instrumentalChain;
    },
    // `clip process` over a chain that SEPARATES, through the job registry — see docs/activeProject.md.
    runColdStep: async ({ step, source, outDir }) => {
      const started = startSeparate({
        userEmail: userEmail ?? "unknown",
        source,
        model: step.model,
        outputs: step.outputs,
        outDir,
      });
      for (;;) {
        const job = separateJob(started.id);
        // Forgotten between two polls: said as itself, since the files may well be on disk.
        if (!job)
          throw new Error(
            `the separation of ${source} was forgotten by this machine — look in ${outDir}`,
          );
        if (job.failed)
          throw new Error(job.error || `separation of ${source} failed`);
        if (job.done) return job.files;
        await new Promise((r) => setTimeout(r, COLD_POLL_MS));
      }
    },
    // `system channel type`: the engine makes the pair NOW, and answers WHETHER one heard it.
    setInputStereo: (channel, stereo) => {
      const c = ensureEngine(ws);
      if (!c || !isReady(ws)) return false;
      c.setInputStereo(channel, stereo);
      return true;
    },
    getAudioDevices: () =>
      new Promise<AudioDeviceInfo[]>((res) => {
        const c = ensureEngine(ws);
        if (!c || !isReady(ws)) {
          res([]);
          return;
        }
        const t = setTimeout(() => res([]), 4000);
        c.once("audioDevices", (devices: AudioDeviceInfo[]) => {
          clearTimeout(t);
          res(devices);
        });
        c.listAudioDevices();
      }),
    gitEnv: webGitEnv(userEmail),
    // Whole-repo git runs at the workspace root — a workspace is one cloned repo — so it works with no project open.
    repoDir: ws.root,
    // The account's libraries are this service's to keep, not the workspace's — docs/libraries.md.
    updateLibraries: () => syncLibraries(userEmail ?? "", { force: true }),
    // A process backs up each render here before overwriting it, feeding the recordChange journal.
    snapshot,
  };
}

/** Verbs that need no active project — a copy of `commands.yaml` names, see docs/activeProject.md. */
const GLOBAL_COMMAND =
  /^(system channel|playlist|project (commit|pull|libraries))\b/;

/** The lines a command produced, plus whether it REFUSED — see docs/activeProject.md. */
export type CommandOutput = string[] & { refused?: boolean };

/** What a run answers: the lines, the revision either side, and what it wrote — docs/activeProject.md. */
export interface WebCommandRun {
  output: CommandOutput;
  before: string;
  after: string;
  /** …and which files it wrote, from the same diff. `null` = not known; see `Recorded`. */
  files: ChangedFile[] | null;
}

export async function runWebCommand(
  ws: Workspace,
  line: string,
  userEmail?: string,
  // The folder the verbs act on when it is not the open project. Absolute; the route checks it.
  at?: string,
): Promise<WebCommandRun> {
  const out: CommandOutput = [];
  // A refusal too, and the first one a caller meets — see docs/activeProject.md.
  if (!at && !ws.activeProjectPath() && !GLOBAL_COMMAND.test(line.trim())) {
    const no: CommandOutput = [NO_PROJECT];
    no.refused = true;
    // Nothing ran: the two instants are one, and `[]` is the truth where `null` would say "re-ask".
    const rev = ws.revision().rev;
    return { output: no, before: rev, after: rev, files: [] };
  }
  // Journal whatever files the command changes, so Ctrl+Z can undo it (a no-op when nothing changed).
  const { before, after, files } = await ws.recordChange(
    line,
    async (snapshot) => {
      try {
        await runCommand(
          line,
          makeHost(ws, out, userEmail, snapshot, at),
          SURFACE,
        );
      } catch (e) {
        out.push(`error: ${(e as Error).message}`);
      }
    },
  );
  // A verb writes beside the service, so the stamp must hear of it BEFORE the graph is built — docs/moduleWatch.md.
  if (after !== before) moduleFoldersMoved();
  return { output: out, before, after, files };
}

export function webCompletions(ws: Workspace, line: string): string[] {
  try {
    return completions(line, makeHost(ws, []), SURFACE);
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
