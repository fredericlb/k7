// engineLink.ts — run the brain's command layer and drive the LOCAL C++ engine, dialled
// once at boot. There is one engine, so the link and the PatternClock are module-level
// singletons and `currentWs` tracks whose project it's playing (so a take lands right).
// Several browser tabs share it — last write wins.

import { relative } from "node:path";
import {
  argClass,
  argHint,
  completions,
  loadCommandSpecs,
  runCommand,
} from "@studio/commands/commandSpec";
import type { CommandHost, TransportAction } from "@studio/commands/commands";
import type { GitEnv } from "@studio/commands/git";
import { addTakeToTrack } from "@studio/commands/recordTake";
import {
  type AudioDeviceInfo,
  EngineClient,
  type PluginInfo,
  type RecordedTake,
} from "@studio/engine-client/engineClient";
import { SESSIONS } from "@studio/engine-protocol/sessions";
import { listBaseModules } from "@studio/song/loader";
import { PatternClock } from "@studio/song/patternClock";
import { loadPreferences } from "@studio/song/preferences";
import type { ProjectDoc, TrackDoc } from "@studio/song/project";
import { strudelPatterns } from "@studio/song/strudel";
import type { CommandInfo } from "@studio/web-protocol";
import chokidar from "chokidar";
import { rootDir } from "./slug.ts";
import { sshCommand } from "./sshKeys.ts";
import type { Workspace } from "./workspace.ts";

const SURFACE = "cli" as const; // the one surface the shared registry defines
const NO_PROJECT =
  "no active project — select a project in the workspace first";
const NO_ENGINE = "engine offline — is the C++ engine running on this machine?";

/** One socket per SESSION, all to the same engine. Keyed by session id. */
interface Link {
  client: EngineClient;
  ready: boolean;
  /** When something last asked for it, so an abandoned one can be reaped — see pruneIdleLinks. */
  lastUsed: number;
}
const links = new Map<string, Link>();

/** How long a link may go untouched before it is dropped. Minutes, not seconds: a person reading
 *  a score between takes is idle, and reconnecting costs a round trip. */
const LINK_IDLE_MS = 5 * 60_000;
let selectedEngineUrl: string | undefined;
let currentWs: Workspace | null = null; // whose project the engine is playing; recorded takes land here

/**
 * Which session a workspace's project belongs to.
 *
 * Derived from the OWNER SLUG in the workspace root — `~/.studio/root/<slug>/<workspace>` —
 * because that slug IS `slugify(email)`, the same string the browser half feeds to
 * `sessionFor`. Two halves, one spelling, without either having to be told.
 *
 * A root that is not under the users root (rootIsProject: a bare folder opened directly)
 * has no owner, and falls back to the bare service id — one machine, one person, which is
 * exactly the case that shape exists for.
 */
export function sessionOf(ws: { root: string } | null): string {
  if (!ws) return SESSIONS.l8;
  const rel = relative(rootDir(), ws.root);
  const slug = rel.split(/[\\/]/)[0];
  if (!slug || slug.startsWith("..")) return SESSIONS.l8;
  return `${SESSIONS.l8}:${slug}`;
}

function wireEngine(session: string, e: EngineClient): void {
  e.on("open", () => {
    const l = links.get(session);
    if (l) l.ready = true;
    try {
      const dev = loadPreferences().audioDevice;
      if (dev) e.setAudioDevice(dev.name, dev.type);
    } catch {
      /* no/invalid preferences — keep the system default */
    }
  });
  e.on("close", () => {
    const l = links.get(session);
    if (l) l.ready = false;
    setTimeout(() => {
      if (links.get(session)?.client === e) e.connect();
    }, 1000);
  });
  e.on("wserror", () => {});
  e.on("state", (s: { playing?: boolean; playhead?: number }) =>
    patternClock.onState(!!s.playing, Number(s.playhead ?? 0)),
  );
  e.on("recorded", onRecorded);
}

/**
 * Take a link out of the map and close it.
 *
 * DELETED BEFORE CLOSED, and that order is the whole function: `wireEngine`'s close handler
 * re-dials unless the map no longer holds this client, so closing first leaves the outcome
 * resting on the close event being asynchronous.
 *
 * `tellEngine` also drops the SESSION, not just the socket — for when the work is genuinely over.
 * An idle prune does not: the person may come back, and their project should still be loaded.
 */
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

/**
 * Close links nothing has used for LINK_IDLE_MS.
 *
 * Without this, `links` only ever grew: a second person served by this file service left the
 * first one's socket open, and `wireEngine`'s close handler re-dials every second forever — so an
 * abandoned link was not merely a leaked socket but a permanent reconnect loop, and it kept that
 * session alive on the engine as well.
 *
 * Exported for the test, and it takes `now` for the same reason.
 */
export function pruneIdleLinks(now: number = Date.now()): string[] {
  const current = sessionOf(currentWs);
  const dropped: string[] = [];
  for (const [session, l] of links) {
    // Never the workspace being played: it is idle between commands by nature.
    if (session === current) continue;
    if (now - l.lastUsed < LINK_IDLE_MS) continue;
    dropLink(session);
    dropped.push(session);
  }
  return dropped;
}

// Dial the local engine; a repeat with the same url is a no-op. The sockets themselves are
// opened lazily, per session, the first time someone's project needs one.
export function setSelectedEngine(url: string): void {
  if (url === selectedEngineUrl && links.size) return;
  selectedEngineUrl = url;
  // A different engine invalidates every session's socket, not just the current one.
  for (const session of [...links.keys()]) dropLink(session);
}

/**
 * The socket for one session, opened on first use.
 *
 * ONE SOCKET PER SESSION rather than one socket carrying several. The engine would accept
 * either — a session is a field on each message — but a socket per session gets each its
 * own outbox and its own reconnect, and the alternative is a shared queue where one user's
 * backlog delays another's transport.
 *
 * Exported so engineLink.test.ts can populate `links` without standing up a Workspace; every
 * caller in this file reaches it as the module-private thing it otherwise is.
 */
export function ensureEngine(
  ws: Workspace | null = currentWs,
): EngineClient | undefined {
  if (!selectedEngineUrl) return undefined;
  const session = sessionOf(ws);
  const existing = links.get(session);
  if (existing) {
    existing.lastUsed = Date.now(); // every use, so pruneIdleLinks only ever sees the abandoned
    return existing.client;
  }
  // The other half of l8' session: this side compiles and sends the project, the browser
  // side drives its transport. Same id or the two steer different projects.
  const client = new EngineClient(selectedEngineUrl, session);
  links.set(session, { client, ready: false, lastUsed: Date.now() });
  wireEngine(session, client);
  client.connect();
  return client;
}

/** Whether this session's socket is open. A fresh one is not, and says so. */
function isReady(ws: Workspace | null = currentWs): boolean {
  return links.get(sessionOf(ws))?.ready ?? false;
}

let orbitTracks: TrackDoc[] = [];
export function strudelOrbitTracks(): TrackDoc[] {
  return orbitTracks;
}
const patternClock = new PatternClock(
  (doc: ProjectDoc) => ensureEngine()?.sendProject(doc),
  undefined,
  (tracks) => {
    orbitTracks = tracks;
  },
);

function loadPatternsFor(ws: Workspace, dir: string): void {
  patternClock.switchTo(dir);
  patternClock.setBaseProject(ws.cachedProjectDoc(dir));
  void patternClock.refreshPatterns(strudelPatterns(dir), dir);
}

function enginePlugins(
  fire: (c: EngineClient) => void,
  out: string[],
  timeoutMs: number,
  rescan: boolean,
): Promise<void> {
  const c = ensureEngine();
  if (!c || !isReady()) {
    out.push(NO_ENGINE);
    return Promise.resolve();
  }
  return new Promise((res) => {
    const t = setTimeout(res, timeoutMs);
    c.once("plugins", (plugins: PluginInfo[]) => {
      clearTimeout(t);
      if (rescan) out.push(`scanned ${plugins.length} plugin(s)`);
      else if (!plugins.length)
        out.push("no plugins cached — run: l8 engine scan");
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

function sendActiveProject(ws: Workspace, p: string): void {
  try {
    loadPatternsFor(ws, p);
  } catch {
    /* malformed project — the timeline/graph endpoints surface the error */
  }
}

let strudelWatcher: ReturnType<typeof chokidar.watch> | null = null;
// Close the strudel watcher and WAIT for the OS to release its handle: on Windows an open one makes the project
// folder un-renameable (EPERM), so deleteProject awaits this before recycling it.
async function closeStrudelWatcher(): Promise<void> {
  if (!strudelWatcher) return;
  const prev = strudelWatcher;
  strudelWatcher = null;
  try {
    await prev.close();
  } catch {
    /* already closing */
  }
}
function watchStrudel(dir: string | null): void {
  if (strudelWatcher) {
    void closeStrudelWatcher(); // switching projects: the old handle can close in the background
  }
  if (!dir) return;
  const onChange = (p: string): void => {
    if (p.endsWith(".strudel"))
      void patternClock.refreshPatterns(strudelPatterns(dir), dir);
  };
  strudelWatcher = chokidar
    .watch(dir, { ignoreInitial: true })
    .on("add", onChange)
    .on("change", onChange)
    .on("unlink", onChange)
    .on("error", () => {});
}

// The project the engine is currently serving.
let engineProject: string | null = null;

// Point the engine at the active project and send it; switching to a DIFFERENT project flushes it first.
export function startEngineForActive(ws: Workspace): void {
  const p = ws.activeProjectPath();
  if (!p) return;
  const switching = engineProject !== null && p !== engineProject;
  engineProject = p;
  currentWs = ws;
  watchStrudel(p);
  if (switching) ensureEngine()?.flush();
  sendActiveProject(ws, p);
}

// Recompile from disk and push — the explicit reload an out-of-band edit needs, since write() only invalidates.
export function reloadActiveProject(ws: Workspace): void {
  ws.invalidateProjectDoc();
  startEngineForActive(ws);
}

// Speculatively load the persisted active project as soon as the workspace is known, so instantiating plugins
// overlaps the browser's startup. Only while the engine is IDLE: /workspace is polled, and two workspaces
// re-asserting on a poll would fight over the one shared engine.
export function prewarmEngineForActive(ws: Workspace): void {
  if (engineProject !== null) return; // engine already serving a project — leave it to /open
  startEngineForActive(ws);
}

// Unload: stop, flush and forget the pointers, so a left workspace neither plays nor catches a recorded take.
export async function unloadEngine(): Promise<void> {
  const leaving = sessionOf(currentWs);
  const e = ensureEngine();
  if (e) {
    try {
      e.transport("stop");
      e.flush();
    } catch {
      /* engine offline — nothing to unload */
    }
  }
  engineProject = null;
  currentWs = null;
  // The one place that means "this workspace is DONE", so it is the one that tells the engine to
  // forget the session rather than merely letting the socket go — an idle prune deliberately does not.
  dropLink(leaving, { tellEngine: true });
  // Await the watcher close: a caller about to rename or delete must not race the OS releasing the handle.
  await closeStrudelWatcher();
}

// Unload ONLY if the engine is serving `projectAbs` — unconditionally would stop a project another tab is driving.
export async function unloadEngineIfServing(
  projectAbs: string,
): Promise<boolean> {
  if (engineProject !== projectAbs) return false;
  await unloadEngine();
  return true;
}

// Audition a file over [start, start+length) seconds; a no-op when the engine is offline — previews are extras.
export function enginePreview(
  file: string,
  start: number,
  length: number,
): void {
  ensureEngine()?.preview(file, start, length);
}

function onRecorded(take: RecordedTake): void {
  const ws = currentWs;
  const dir = ws?.activeProjectPath();
  if (!ws || !dir) return;
  try {
    const id = addTakeToTrack(dir, ws.cachedProjectDoc(dir), take);
    ws.invalidateProjectDoc();
    loadPatternsFor(ws, dir);
    console.log(`[rec] ${take.track}: added clip ${id}`);
  } catch (e) {
    console.error(
      `[rec] ${take.track}: recorded ${take.file} but could not add it to the track: ${(e as Error).message}`,
    );
  }
}

// Pin git to this user's deploy key — the one the workspace was cloned with — so push/pull authenticate as them.
// GIT_TERMINAL_PROMPT=0 fails rather than hanging. The global config stays: a commit needs its user.name/email.
export function webGitEnv(userEmail?: string): GitEnv {
  return userEmail
    ? { GIT_SSH_COMMAND: sshCommand(userEmail), GIT_TERMINAL_PROMPT: "0" }
    : undefined;
}

function makeHost(
  ws: Workspace,
  out: string[],
  userEmail?: string,
  snapshot?: (absPath: string) => void,
): CommandHost {
  const dir = ws.activeProjectPath();
  const requireDir = (): string => {
    if (!dir) throw new Error(NO_PROJECT);
    return dir;
  };
  // The module vocabulary reads every module file (~1s), and only `create module` needs it — so it is a memoized
  // getter, loaded at most once per request and not at all for a mixer move.
  let baseModuleCache: string[] | undefined;
  return {
    songPath: dir ?? "",
    project: () => ws.cachedProjectDoc(requireDir()),
    get baseModules(): string[] {
      return (baseModuleCache ??= dir ? safeBaseModules(dir) : []);
    },
    log: (lines) => out.push(...lines),
    reload: () => {
      try {
        ws.invalidateProjectDoc();
        loadPatternsFor(ws, requireDir());
      } catch (e) {
        out.push(`reload error: ${(e as Error).message}`);
      }
    },
    transport: (a: TransportAction) => ensureEngine()?.transport(a),
    arm: (track) =>
      new Promise<boolean | undefined>((res) => {
        const c = ensureEngine();
        if (!c || !isReady()) {
          out.push(NO_ENGINE);
          return res(undefined);
        }
        const t = setTimeout(() => {
          out.push("engine did not answer the arm");
          res(undefined);
        }, 2000);
        const done = (v?: boolean) => {
          clearTimeout(t);
          res(v);
        };
        c.once("armed", (a: { track: string; armed: boolean }) =>
          done(a.armed),
        );
        c.once("engineError", (m: string) => {
          out.push(m);
          done(undefined);
        });
        c.arm(track);
      }),
    applyProject: (p) => {
      ws.setCachedProjectDoc(requireDir(), p);
      patternClock.setBaseProject(p);
    },
    sendProject: (p) => patternClock.setBaseProject(p),
    // Say so when there is nothing to ask: the caller reports "opening…" either way, so silence reads as a dead button.
    showNativePluginUI: (id) => {
      const e = ensureEngine();
      if (!e) out.push(NO_ENGINE);
      else e.showNativePluginUI(id);
    },
    listPlugins: (filter) =>
      enginePlugins((c) => c.listPlugins(filter), out, 4000, false),
    rescanPlugins: (force) =>
      enginePlugins((c) => c.rescanPlugins(force), out, 60000, true),
    getPlugins: (filter) =>
      new Promise<PluginInfo[]>((res) => {
        const c = ensureEngine();
        if (!c || !isReady()) {
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
    getAudioDevices: () =>
      new Promise<AudioDeviceInfo[]>((res) => {
        const c = ensureEngine();
        if (!c || !isReady()) {
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
    // A process backs up each render here before overwriting it, feeding the recordChange journal.
    snapshot,
  };
}

/**
 * Commands that need no active project: the rig preferences, and the whole-repo git ones.
 *
 * The git verbs are `project commit` and `project pull` — this listed a bare `commit|pull`,
 * which matches NEITHER, so both were refused with "no project" whenever none was open. It
 * went unnoticed because l8's command bar always has one; st0 creating a project it never
 * opens is the first caller to arrive without.
 *
 * These are VERBS FROM `commands.yaml`, and this list has drifted from it once already —
 * check there before adding to it.
 */
const GLOBAL_COMMAND = /^(channel|audio|project (commit|pull))\b/;

export async function runWebCommand(
  ws: Workspace,
  line: string,
  userEmail?: string,
): Promise<string[]> {
  const out: string[] = [];
  if (!ws.activeProjectPath() && !GLOBAL_COMMAND.test(line.trim()))
    return [NO_PROJECT];
  // Journal whatever files the command changes, so Ctrl+Z can undo it (a no-op when nothing changed).
  await ws.recordChange(line, async (snapshot) => {
    try {
      await runCommand(line, makeHost(ws, out, userEmail, snapshot), SURFACE);
    } catch (e) {
      out.push(`error: ${(e as Error).message}`);
    }
  });
  return out;
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
      // The trailing user args in order, each with the class of thing it names, so the palette can colour its field.
      args:
        c.args?.map((a) => ({
          name: a.name,
          kind: argClass(a),
          hint: argHint(a),
        })) ?? [],
    }));
}
