// engineLink.ts — run the brain's command layer and drive the LOCAL C++ engine, dialled
// once at boot. One engine, but one SESSION per workspace owner: `served` says what this
// service sent to each of them, so a re-send or a take resolves its workspace explicitly.
// The PatternClock is the one real singleton — see docs/activeProject.md.

import type { Stats } from "node:fs";
import { basename, relative } from "node:path";
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
  type PluginParamInfo,
  type RecordedTake,
} from "@studio/engine-client/engineClient";
import type { SessionInfo } from "@studio/engine-client/engineControl";
import { SESSIONS } from "@studio/engine-protocol/sessions";
import { listBaseModules } from "@studio/song/loader";
import { PatternClock } from "@studio/song/patternClock";
import { loadPreferences } from "@studio/song/preferences";
import type { ProjectDoc, TrackDoc } from "@studio/song/project";
import { strudelPatterns } from "@studio/song/strudel";
import {
  type CommandInfo,
  ENGINE_RECONNECT_MIN_MS,
} from "@studio/web-protocol";
import chokidar from "chokidar";
import { guard } from "./background.ts";
import { closeModuleWatch, watchModuleFolders } from "./moduleWatch.ts";
import { rootDir } from "./slug.ts";
import { sshCommand } from "./sshKeys.ts";
import { skip, type Workspace } from "./workspace.ts";

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
  /** Consecutive failed dials, reset by a socket that opened. Drives the reconnect backoff. */
  attempt: number;
}
const links = new Map<string, Link>();

/** How long a link may go untouched before it is dropped. Minutes, not seconds: a person reading
 *  a score between takes is idle, and reconnecting costs a round trip. */
const LINK_IDLE_MS = 5 * 60_000;

/**
 * The reconnect backoff's ceiling HERE — deliberately not the browser's.
 *
 * `ENGINE_RECONNECT_MAX_MS` is 30 s and its own comment says why: "so a forgotten tab stops
 * hammering the relay". Neither half of that is true on this side. There is no forgotten tab —
 * this is a service dialling `127.0.0.1`, where a refusal costs one instant loopback connect
 * rather than a sequential dial of every address an engine ever advertised. And the engine
 * restarts on every C++ save in the dev session, so what the ceiling really buys is the delay
 * before edits reach the audio again.
 *
 * Taking the browser's number gave that delay up to thirty seconds where it had been one, which
 * reads exactly like the engine ignoring your edit — the backoff is what a restart resets.
 * Doubling still stops the 1 Hz spin; the ceiling is what has to fit the distance.
 */
const LOCAL_RECONNECT_MAX_MS = 4000;
let selectedEngineUrl: string | undefined;

/**
 * What this service last SENT to one session — the workspace it came from and the project.
 *
 * The record every path here used to take from one module-global `currentWs`, and the reason
 * that hurt: it is written by `/open` and nothing else, so between a service restart and the
 * next open it is null, and everything defaulting through it addressed `sessionOf(null)` —
 * the BARE service id, a session the engine holds nothing in. Sending to an empty session is
 * the quietest failure this codebase has: the engine answers nothing and reports nothing.
 *
 * Keyed by session, because that is the identifier every side already agrees on: the socket
 * knows which one delivered a frame, `sessionOf(ws)` names one from a request. So a socket
 * re-opening asks "what was I serving?" and a take asks "whose project is this?" instead of
 * both consulting a global that may be about somebody else — or about nobody at all.
 */
interface Served {
  ws: Workspace;
  /** The project path we sent — what the ENGINE holds, which a take belongs to even if the
   *  workspace has since made another one active. */
  project: string;
  /** The reconcile throttle, per session: two of them must not starve each other. */
  lastReconcile: number;
  reconciling: boolean;
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
  });
}

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
  if (!ws) return SESSIONS.st0;
  const rel = relative(rootDir(), ws.root);
  const slug = rel.split(/[\\/]/)[0];
  if (!slug || slug.startsWith("..")) return SESSIONS.st0;
  return `${SESSIONS.st0}:${slug}`;
}

function wireEngine(session: string, e: EngineClient): void {
  e.on("open", () => {
    const l = links.get(session);
    if (l) {
      l.ready = true;
      l.attempt = 0; // a socket that opened earns the next outage a fresh, short first wait
    }
    // Whatever the clock believes the engine is holding, it no longer does — a fresh socket can
    // mean a fresh engine. Said BEFORE anything is re-sent, so the first emit after this is a
    // whole document and not a delta aimed at a project that is not there.
    patternClock.forgetSent();
    try {
      const prefs = loadPreferences();
      if (prefs.audioDevice)
        e.setAudioDevice(prefs.audioDevice.name, prefs.audioDevice.type);
      // …and how that interface's inputs are GROUPED, which the engine remembers no better than
      // which interface it is. AFTER the device, and the order is load-bearing: opening one
      // rebuilds the wave devices from scratch, so a pairing sent first would be thrown away.
      for (const first of prefs.inputPairs) e.setInputStereo(first, true);
    } catch {
      /* no/invalid preferences — keep the system default */
    }
    // Re-send the project THIS session was serving. A fresh socket can mean a fresh ENGINE —
    // it crashed and the supervisor respawned it — and that engine holds no session at all,
    // while `served` below still says we are serving one. Nothing then re-sent it: the
    // 2 s /workspace poll takes `prewarmEngineForActive`'s early return, the browser shows a
    // project the engine has never heard of, and the transport does nothing for ever. Observed
    // exactly that: the file service naming an active project against an engine reporting
    // `loaded=false, 0 tracks`, unstuck only by an explicit /open.
    //
    // Asked of `served`, so each session restores ITS OWN and one serving nothing restores
    // nothing — the global pair this replaces described the last workspace to open, and left
    // everybody else's socket declining to re-send. See docs/activeProject.md.
    //
    // Cheap to do unconditionally: the engine DIFFS what arrives, so a reconnect to an engine
    // that still has it answers "no changes (project already current)".
    const s = served.get(session);
    if (s) sendActiveProject(s.ws, s.project);
  });
  // Doubled and jittered, but capped SHORT. It was a flat second for ever: a machine whose engine
  // is off knocked once a second for as long as the service lived, and `pruneIdleLinks` does not
  // stop it — it skips any session in `served`, which is precisely the one holding a project. The
  // jitter is for the other half: several sessions dropped by one engine restart would otherwise
  // come back in lockstep.
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
  // Not silent: a refused dial against the local engine used to leave no trace at all, which is
  // how "the engine is off" and "the engine is wedged" came to look identical from the logs.
  e.on("wserror", (err: Error) =>
    console.error(`   ✗ engine socket ${session}: ${err.message}`),
  );
  e.on("state", (s: { playing?: boolean; playhead?: number }) =>
    patternClock.onState(!!s.playing, Number(s.playhead ?? 0)),
  );
  // The session is carried by the SOCKET, not by the frame — `forSession` has already dropped
  // everyone else's — so it is what tells a take whose project it belongs to.
  e.on("recorded", (take: RecordedTake) => onRecorded(session, take));
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
  const dropped: string[] = [];
  for (const [session, l] of links) {
    // Never a session holding a project: it is idle between commands by nature. Read off
    // `served` rather than off one "current" workspace, which protected the last opener's
    // session and reaped everybody else's out from under a project still loaded.
    if (served.has(session)) continue;
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
 * The workspace is REQUIRED, and that is the whole guard: it used to default to the global
 * `currentWs`, so a caller with a workspace in hand could silently address somebody else's
 * session — or, before any /open, the bare one the engine holds nothing in. Pass `null` only
 * where there genuinely is no workspace; the bare id is then the answer, not an accident.
 *
 * Exported so engineLink.test.ts can populate `links` without standing up a Workspace; every
 * caller in this file reaches it as the module-private thing it otherwise is.
 */
export function ensureEngine(ws: Workspace | null): EngineClient | undefined {
  if (!selectedEngineUrl) return undefined;
  const session = sessionOf(ws);
  const existing = links.get(session);
  if (existing) {
    existing.lastUsed = Date.now(); // every use, so pruneIdleLinks only ever sees the abandoned
    return existing.client;
  }
  // The other half of st0' session: this side compiles and sends the project, the browser
  // side drives its transport. Same id or the two steer different projects.
  //
  // And deliberately NOT a driver. The engine counts sockets that declare `role: "driver"` on
  // hello and frees a project 45 s after the last one goes (engine/moteur/docs/sessions.md).
  // This link is held for as long as the machine is up, so counting it would mean no project
  // ever looked abandoned — which is the whole point of the count. Saying nothing is what keeps
  // it out; there is no flag to pass.
  const client = new EngineClient(selectedEngineUrl, session);
  links.set(session, {
    client,
    ready: false,
    lastUsed: Date.now(),
    attempt: 0,
  });
  wireEngine(session, client);
  client.connect();
  return client;
}

/** Whether this session's socket is open. A fresh one is not, and says so. */
function isReady(ws: Workspace | null): boolean {
  return links.get(sessionOf(ws))?.ready ?? false;
}

let orbitTracks: TrackDoc[] = [];
export function strudelOrbitTracks(): TrackDoc[] {
  return orbitTracks;
}

/**
 * Whose project the pattern clock is holding — the one thing here that is legitimately global.
 *
 * The clock, its strudel watcher and the browser-supplied `clientDoc` below are a SINGLE
 * running thing: one project's patterns, one file watcher, one overlay. Several workspaces can
 * be served at once (each has its own engine session and its own `served` entry) but only the
 * most recent one owns the clock — last write wins, as it always has. What this variable adds
 * is that the clock's sends now go to THAT workspace's session instead of to a global set only
 * by /open, so an overlay pushed after a restart lands in the room the song is in.
 */
let clockWs: Workspace | null = null;

const patternClock = new PatternClock(
  (doc: ProjectDoc) => ensureEngine(clockWs)?.sendProject(doc),
  undefined,
  (tracks) => {
    orbitTracks = tracks;
  },
  // The delta channel: while only the lanes' clips move, the engine is handed those tracks and
  // not the song. Same socket and the same outbox, so it cannot overtake the document it amends.
  (doc: ProjectDoc, ids: string[]) =>
    ensureEngine(clockWs)?.sendTracks(doc, ids),
);

/**
 * A document a BROWSER built and handed over, in force until the project changes underneath it.
 *
 * The turntables surface is the one thing that makes one: it takes this project's compile and
 * fills the decks' clips into it. That used to go straight out of the browser on its own socket,
 * which made two writers for one engine — the service pushing the compile from disk, the surface
 * pushing the compile-with-decks — and whichever wrote last won. Now there is one socket and one
 * rule, both here. See packages/song/docs/surfaces.md.
 */
let clientDoc: ProjectDoc | null = null;

/** Forget any browser-supplied document — a different project is being served. */
function dropClientProject(): void {
  clientDoc = null;
}

/**
 * Hand the singleton clock a document, and with it the workspace whose session to send in.
 *
 * The two go together or not at all: the clock sends from inside `setBaseProject`, so a base set
 * without an owner goes wherever the previous one went — which after a restart is the bare
 * session, the empty room.
 */
function setClockProject(ws: Workspace, doc: ProjectDoc): void {
  clockWs = ws;
  patternClock.setBaseProject(doc);
}

/**
 * Play a document a browser built, through the service's own link.
 *
 * It becomes the pattern clock's BASE, which is what makes this one path rather than two: a
 * strudel lane still overlays its events, and the actual `sendProject` is the same call the
 * disk-driven push makes. The engine diffs, so a song already playing keeps playing under it.
 *
 * `ws` is the requesting workspace, for the same reason `enginePreview` takes one: the
 * turntables surface can hand over a deck-filled document before anything has opened a project
 * on this service, and without it that document went to the bare session and was never heard.
 */
export function applyClientProject(ws: Workspace, doc: ProjectDoc): void {
  clientDoc = doc;
  setClockProject(ws, doc);
}

function loadPatternsFor(ws: Workspace, dir: string): void {
  clockWs = ws; // BEFORE switchTo: the clock sends from inside it, and must know where to
  patternClock.switchTo(dir);
  // NOT while a browser holds the document. It would push the bare compile — the same project
  // with the decks' clips gone — and the surface would blink empty until its next gesture. The
  // browser polls `/revision`, rebuilds from the fresh compile and hands it back, so the new
  // state arrives complete instead of arriving twice.
  if (!clientDoc) setClockProject(ws, ws.cachedProjectDoc(dir));
  guard(
    "pattern refresh",
    patternClock.refreshPatterns(strudelPatterns(dir), dir),
  );
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

/**
 * How long the engine gets to load a plugin and list its parameters.
 *
 * Twenty seconds, against two for a session listing and four for the cached plugin list. This
 * one CONSTRUCTS the plugin — the only way to learn what it has — and a large sampler or an
 * Arturia synth measured seconds of that on this machine. The timeout is what stops a wedged
 * plugin from holding a request forever, not a latency budget.
 */
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

/**
 * What one plugin answered: whether it loaded, and what it then declared.
 *
 * THREE outcomes, not two, and flattening them is what made this shape necessary. `undefined`
 * from the wait below is "the engine never answered"; `found: false` is "it answered, and this
 * machine cannot find, create or LOAD that plugin"; `found: true, params: []` is "it loaded and
 * publishes none".
 *
 * The middle one is where the interesting failures live: twenty-seven plugins on the machine this
 * was written on refuse to load, and until the engine checked `getLoadError` they arrived here as
 * the third case — reported as plugins with nothing to offer, when what they need is a licence.
 */
export interface PluginParamAnswer {
  found: boolean;
  params: PluginParamInfo[];
}

/**
 * Ask the engine what one installed plugin's parameters are. `undefined` = it never answered.
 *
 * MATCHED ON THE ID, and that is the whole reason this is not a `once`. The reply is broadcast
 * to every socket on the engine, so another surface asking about a different plugin would
 * otherwise resolve this wait with an answer to somebody else's question — and the panel drawn
 * from it would carry the wrong plugin's knobs, silently, which is the one failure mode a
 * generated panel must not have.
 *
 * An empty list is a real answer and arrives with `found: true`. `undefined` is reserved for
 * silence — see `PluginParamAnswer` for why the three are kept apart.
 */
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
      // An engine too old to send the flag loaded SOMETHING to answer at all, so absent reads
      // as true — the same default the client applies.
      done({ found: p.found !== false, params: p.params });
    };
    const timer = setTimeout(() => done(undefined), timeoutMs);
    c.on("pluginParamList", onList);
    c.listPluginParams(format, id);
  });
}

/**
 * …asked of THIS machine's engine, on the bare session.
 *
 * No workspace, deliberately: which plugins exist and what they have is a fact about the
 * MACHINE, exactly like `/plugins` and its scan cache. The médiathèque asks it while no project
 * is open at all — it edits a library — and routing it through a session would send it to a
 * room the engine holds nothing in.
 */
export async function pluginParams(
  format: string,
  id: string,
): Promise<PluginParamAnswer | undefined> {
  const c = ensureEngine(null);
  // No `isReady` check, unlike the arm and the session listing. Those are asked mid-session on a
  // link something else already opened; this is the FIRST thing to want the bare session on many
  // machines, so it routinely arrives while the socket is still dialling — and `send` buffers
  // until open, so asking anyway is what makes the first click work. An engine that is not there
  // costs the timeout instead of an instant no, which is the right side to be wrong on for a
  // question whose honest answer takes seconds.
  if (!c) return undefined;
  return awaitPluginParams(c, format, id);
}

/**
 * …and the same plugin's own WINDOW, opened on an orphan instance.
 *
 * On the bare session for the same reason as `pluginParams` above: which plugins exist, what they
 * have, and what they look like are all facts about the MACHINE, and the caller is a module being
 * authored rather than a project being played.
 *
 * FIRE-AND-FORGET, unlike the param query, and not for want of trying: the window opens on the
 * engine's screen, so the only thing that could be awaited is the engine saying it drew one, which
 * tells the caller nothing it can act on. What CAN be reported is the one failure worth a sentence
 * — no engine to ask — which is what the boolean is. Everything past that (a plugin that will not
 * load, a plugin with no editor) reaches the human on the warning channel, where the engine's own
 * account of it is better than anything this could invent.
 */
/**
 * How long the engine gets to open the window. Generous, because the honest answer takes that
 * long: the binary has to be loaded, and a big Arturia synth measured fourteen seconds cold on
 * this machine. Past it the caller is told nothing happened, which is the truth — the load may
 * still be running, but a window that appears a minute after a click is not the one you asked for.
 */
export const NATIVE_UI_TIMEOUT_MS = 30_000;

interface NativeUiFrame {
  format: string;
  id: string;
  ok: boolean;
}

/**
 * Open the plugin's own WINDOW on an orphan instance, and wait to hear whether it did.
 *
 * AWAITED, and it did not used to be. This returned true the moment `ensureEngine` handed back a
 * client — which it does whether or not that client's socket has ever connected, since `send`
 * buffers. So a click reported an open window while the message sat in an outbox, or while a
 * plugin load hung inside the engine, and the one thing the user saw was nothing at all. There is
 * no reply that says "buffered", so the only sound test is the engine saying it drew the window.
 *
 * `undefined` is "nobody answered" — no engine, or a load still running or wedged past the
 * timeout. `{ok:false}` is the engine answering that it could not draw one. Both leave no window,
 * and only the second has anything to say about why, so they must not arrive spelt the same way.
 */
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

/** How long the engine gets to write a base. Short: nothing is LOADED here — the instance is
 *  already open — so this is a state read and a small file, not another plugin construction. */
export const PLUGIN_BASE_TIMEOUT_MS = 5_000;

interface PluginBaseFrame {
  path: string;
  ok: boolean;
}

/**
 * Snapshot the orphan's state into `absPath`, and wait to hear whether it landed.
 *
 * AWAITED, unlike opening the window, and the difference is what there is to say. A window either
 * appears on somebody's screen or does not, and no reply helps; a snapshot either produced a file
 * or produced nothing, and which one decides whether the caller may tell the user a base exists.
 *
 * `undefined` is "the engine never answered" — no engine, or one that went away mid-write.
 * `{ok:false}` is the engine answering that there was nothing to write: no window was ever opened
 * for this plugin, or the plugin has no state to give. Both leave no file, and only the second is
 * something the user can act on, so they must not arrive spelt the same way.
 */
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

/**
 * Compile `p` and push it to `ws`' session, recording that this is what that session holds.
 *
 * The note is taken FIRST, and even when the compile throws: a session serving a project the
 * compiler currently refuses is still serving that project, and the reconcile and the socket's
 * `open` both need to know which one to try again with.
 */
function sendActiveProject(ws: Workspace, p: string): void {
  noteServed(ws, p);
  try {
    loadPatternsFor(ws, p);
  } catch (e) {
    // Still not fatal — /project-doc and /graph surface a malformed project to the browser —
    // but never silent: this is the one path whose failure leaves the engine holding nothing.
    console.error(
      `   ✗ could not send ${basename(p)} to the engine: ${(e as Error).message}`,
    );
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
/**
 * What the watcher below refuses to carry — and it used to carry everything under the project.
 *
 * `ignoreInitial` only silences the first events; chokidar still walks and remembers the whole
 * tree, so a project with a `media/` folder of takes had every one of them statted and held for
 * the sake of a handful of `.strudel` files.
 *
 * Two rules, and the second is why this is not a blacklist of heavy folders. Directories are
 * pruned by `skip()` — the file service's own idea of what is not part of a project, so there is
 * no second list to keep in step and nothing a person could have authored inside one. FILES are
 * kept only when they are patterns, wherever they sit: that is what makes `media/` cheap without
 * anyone having to predict where a pattern is allowed to live.
 *
 * The two-call shape is chokidar 3's: a two-argument predicate is asked once with the path alone
 * and again with its `Stats`. Nothing may be ignored on the first call, or a file would be
 * dropped before its kind is known.
 */
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

function watchStrudel(dir: string | null): void {
  if (strudelWatcher) {
    void closeStrudelWatcher(); // switching projects: the old handle can close in the background
  }
  if (!dir) return;
  const onChange = (p: string): void => {
    if (p.endsWith(".strudel"))
      guard(
        "pattern refresh",
        patternClock.refreshPatterns(strudelPatterns(dir), dir),
      );
  };
  strudelWatcher = chokidar
    .watch(dir, {
      ignoreInitial: true,
      ignored: (p: string, stats?: Stats) => outsideTheWatch(dir, p, stats),
    })
    .on("add", onChange)
    .on("change", onChange)
    .on("unlink", onChange)
    // A watcher that dies here stops feeding pattern edits to the engine for ever, and used to do
    // it without a word. Unlike moduleWatch, this one has no walk-anyway ceiling to heal it — so
    // the line is all there is, and it is what tells you why editing a .strudel stopped working.
    .on("error", (err: unknown) =>
      console.error(
        `   ✗ strudel watcher: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
}

// Point the engine at the active project and send it; switching to a DIFFERENT project flushes it first.
export function startEngineForActive(ws: Workspace): void {
  const p = ws.activeProjectPath();
  if (!p) return;
  // What THIS session was serving, not what the service last touched: another person opening
  // their song is not this session switching projects, and flushing on it emptied a running one.
  const before = served.get(sessionOf(ws))?.project ?? null;
  const switching = before !== null && p !== before;
  watchStrudel(p);
  // …and the module folders, for a different consumer: the strudel watcher RELOADS patterns, this
  // one only lets `@studio/song` skip its stamp walk. Started here because this is where a project
  // becomes the one being served, and closed in `unloadEngine` beside the other, which is what a
  // caller about to rename the folder awaits.
  watchModuleFolders(p);
  if (switching) {
    ensureEngine(ws)?.flush();
    // A document built for the project we are LEAVING must not survive into this one.
    dropClientProject();
    // …nor its module watch, or every project ever opened would keep four directory handles
    // for the life of the process — and on Windows a held handle is what refuses a rename.
    forgetModuleWatch(before);
  }
  sendActiveProject(ws, p);
}

/**
 * Close the module watch on `project`, unless somebody else is still being served it.
 *
 * Two people can have one shared project open, so "this session left it" is not "nobody is on
 * it". Closing it under them would cost them the fast path and nothing else — the oracle
 * answers false for a project it does not watch — but leaving it open when the folder is about
 * to be renamed is the failure that matters, so the check is here rather than skipped.
 */
function forgetModuleWatch(project: string): void {
  for (const s of served.values()) if (s.project === project) return;
  closeModuleWatch(project);
}

// Recompile from disk and push — the explicit reload an out-of-band edit needs, since write() only invalidates.
export function reloadActiveProject(ws: Workspace): void {
  // An explicit reload outranks a browser's document: somebody asked for what is on disk, and
  // answering "no, a surface has the engine" would be refusing the one command that exists to
  // force this. The surface's next gesture — or its next `/revision` tick — hands its own back.
  dropClientProject();
  ws.invalidateProjectDoc();
  startEngineForActive(ws);
}

/** How often the /workspace poll may re-ask the engine what it holds. Polled every 2 s, per tab. */
export const RECONCILE_EVERY_MS = 5_000;
/** How long the engine gets to answer that question before its link is treated as dead. */
export const SESSIONS_TIMEOUT_MS = 2000;

/** The slice of EngineClient a reconcile needs — so the wait can be tested without a socket. */
export interface SessionListingClient {
  on(event: "sessions", fn: (s: SessionInfo[]) => void): unknown;
  off(event: "sessions", fn: (s: SessionInfo[]) => void): unknown;
  listSessions(): void;
}

/**
 * Ask the engine what it is holding. `undefined` means it did not answer at all.
 *
 * `on`/`off` rather than `once`, for awaitArm's reason: a `once` that never fires outlives the
 * request, and the next answer resolves a wait nobody is watching any more.
 *
 * The reply is engine-global and carries no session, so it passes every client's filter
 * (`forSession` in @studio/engine-protocol/sessions).
 */
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

/**
 * Check that the engine really holds what `served` claims for this session, and put it back if not.
 *
 * `served` is this process's belief about another process's state, and the two drift
 * silently — see docs/activeProject.md. This asks rather than remembers.
 *
 * Two faults with two cures. A session the engine is not holding is simply re-sent. An engine
 * that does not ANSWER is the worse one: a link can sit ESTABLISHED and `ready` and be inert
 * both ways, so nothing reports a fault and no re-send can land. Only a fresh socket clears it.
 *
 * Only `loaded` is checked, not WHICH project: the wire carries a display name and this side
 * holds a path, so comparing them would invent a mismatch. Switching projects is
 * startEngineForActive's job anyway.
 */
async function reconcileEngine(
  ws: Workspace,
  s: Served,
  now: number,
): Promise<void> {
  // Throttled PER SESSION — one in flight and one per RECONCILE_EVERY_MS each, not shared:
  // a single pair of module-level flags let one person's poll eat the other's turn.
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
    if (held.some((s) => s.id === session && s.loaded)) return;
    console.warn(
      `   ⚠ engine is not holding ${basename(serving)} — re-sending it`,
    );
    sendActiveProject(ws, serving);
  } finally {
    s.reconciling = false;
  }
}

/**
 * The 2 s poll's engine upkeep: load the persisted project when the engine is idle, and
 * otherwise make sure it still has the one we think it has.
 *
 * Loading speculatively lets plugin instantiation overlap the browser's remaining startup.
 *
 * Both questions are asked of THIS workspace's session. They used to be asked of one global
 * pair, which conflated "this session is already served" with "somebody, somewhere is": a
 * second person's poll matched neither branch — engineProject was set, so no start; the
 * session differed, so no reconcile — and their project was never sent at all. The old comment
 * called that guard "two of them fighting over the one shared engine"; the engine keeps one
 * edit PER session, so there is nothing to fight over once each poll minds its own.
 */
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

/**
 * Unload ONE workspace's session: stop, flush and forget it, so a left workspace neither plays
 * nor catches a recorded take. `null` names the bare session, as everywhere else here.
 *
 * The workspace is a parameter rather than the global it was, for the reason the whole file
 * moved: the caller is a route with `req.ws` in hand, and taking the last opener's session
 * instead meant a second person's /engine/unload stopped somebody else's song and left their
 * own playing.
 */
export async function unloadEngine(ws: Workspace | null): Promise<void> {
  const leaving = sessionOf(ws);
  // Read BEFORE `served.delete` below — this is the only record of which folder was being served,
  // and the module watch on it has to be closed by name.
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
  // The clock and the browser's document are singletons, so they are only given up when it is
  // THIS session that owned them — otherwise leaving one workspace silenced another's overlay.
  if (clockWs && sessionOf(clockWs) === leaving) {
    clockWs = null;
    dropClientProject();
  }
  // The one place that means "this workspace is DONE", so it is the one that tells the engine to
  // forget the session rather than merely letting the socket go — an idle prune deliberately does not.
  dropLink(leaving, { tellEngine: true });
  // Await the watcher close: a caller about to rename or delete must not race the OS releasing the handle.
  await closeStrudelWatcher();
  // The module watch on THIS workspace's project, for the same reason: its roots sit inside the
  // folder `deleteProject` is about to rename, and on Windows a handle inside one is what makes
  // its parent refuse. Synchronous — `fs.watch` closes without a promise. Read above, before
  // `served.delete` cleared the only record of which folder it was.
  if (leftProject) forgetModuleWatch(leftProject);
}

/**
 * Unload whichever session is serving `projectAbs` — unconditionally would stop a project
 * another tab is driving. Every session is checked, not one global: two people can have the
 * same shared project open, and deleting the folder must not leave the other holding it.
 */
export async function unloadEngineIfServing(
  projectAbs: string,
): Promise<boolean> {
  const holders = [...served.values()].filter((s) => s.project === projectAbs);
  for (const s of holders) await unloadEngine(s.ws);
  return holders.length > 0;
}

/**
 * Audition a file over [start, start+length) seconds; a no-op when the engine is offline —
 * previews are extras.
 *
 * The REQUEST's workspace, deliberately not a global: the one this used to default to was set
 * only by /open, so after a service restart it was null until somebody reopened a project — and
 * a preview aimed through it landed on the BARE default session, whose edit is empty.
 * previewSample then returns without a word: sound-free and error-free, which is exactly how it
 * read — a ▶ that clicks and says nothing.
 */
export function enginePreview(
  ws: Workspace | null,
  file: string,
  start: number,
  length: number,
): void {
  ensureEngine(ws)?.preview(file, start, length);
}

/**
 * The take this service turned into a clip most recently, for the browser to review.
 *
 * Here rather than pushed to the browser, because only this side ever learns the clip's ID: the
 * engine broadcasts a FILE and a track, and the id is chosen right below, by the code that writes
 * the clip. The browser polls /workspace anyway, so it costs no round trip of its own — and it is
 * never cleared, because "the last take" stays true until there is another one. Whether it has been
 * looked at is the client's business, not this one's.
 *
 * Per SESSION, so it is the person who recorded it who is shown it: one variable handed the
 * newest take to whoever polled next, which for a shared file service is a clip appearing in a
 * project it was not recorded into.
 */
export type TakeRef = { clip: string; track: string };
const lastTakes = new Map<string, TakeRef>();
export const takeJustRecorded = (ws: Workspace | null): TakeRef | null =>
  lastTakes.get(sessionOf(ws)) ?? null;

/**
 * Turn a finished take into a clip, in the project the SESSION that recorded it is serving.
 *
 * `session` comes from the socket that delivered the frame, and `served` turns it back into a
 * workspace and a project path. It used to read a global set only by /open, which after a
 * service restart is null — so a take recorded before anyone reopened a project was written to
 * disk by the engine and then dropped here with nothing said at all. The wav still exists; the
 * point is that nobody could tell it was orphaned.
 *
 * The project is the one we SENT, not the workspace's active one: the engine recorded into what
 * it holds, and if the active project has moved on since, the take still belongs to the old one.
 */
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
    loadPatternsFor(ws, project);
    lastTakes.set(session, { clip: id, track: take.track });
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

/**
 * Wait for the engine's answer to ONE arm. `undefined` means it did not take, and `out` says why.
 *
 * Matched on the TRACK, because `armed` is broadcast to every client in the session: another
 * surface arming a different track used to resolve this wait with a frame that was not its
 * answer — and then the arm actually asked for waited for a frame already consumed, and timed
 * out. Two surfaces arming at once is not exotic; the timeline's `a` button and `rec` are two.
 *
 * Every path REMOVES both listeners. They were `once`, which never fires on a timeout: the
 * leaked `engineError` listener outlived the request and swallowed the next engine error into an
 * `out` array nobody reads any more, so a later command lost its message.
 */
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
    // Both remaining states get named. "engine did not answer" alone could not tell a dropped
    // link from a silent engine, and the engine prints its own `[rec]` line either way — so
    // saying which half to look in is the difference between a report and a dead end.
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
  // Where the verbs act, when it is NOT the open project: the chains builder edits a template in
  // `_libraries`, which is a graph document of its own. Absolute, already resolved and checked by
  // the caller — a path from a browser never reaches this without going through `safePath`.
  at?: string,
): CommandHost {
  const dir = at ?? ws.activeProjectPath();
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
    // The same lines, and a flag on the reply. `refused` belongs to the whole command rather than
    // to a line, because a handler that refuses returns — so there is one verdict per reply and
    // nothing downstream has to decide which line was the no.
    refuse: (lines) => {
      out.refused = true;
      out.push(...lines);
    },
    reload: () => {
      try {
        ws.invalidateProjectDoc();
        loadPatternsFor(ws, requireDir());
      } catch (e) {
        out.push(`reload error: ${(e as Error).message}`);
      }
    },
    // Every engine call below names `ws`: a command knows whose workspace it runs in, and
    // defaulting instead sent transport and arm to the bare session — the empty room.
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
      setClockProject(ws, p);
    },
    sendProject: (p) => setClockProject(ws, p),
    // Say so when there is nothing to ask: the caller reports "opening…" either way, so silence reads as a dead button.
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
    // A clip's source envelope, for `event trim`. Straight through to the workspace's waveform
    // machinery, which is where the `.cache` sidecar and the engine that builds it already live —
    // the WHOLE file, since a trim is about the source's silence and not the placement's span.
    // `ws`, not a global: the clip named is one of THIS command's project's, and reading it out
    // of another workspace's tree answered null for a file that was right there.
    clipEnvelope: async (clip: string) => {
      try {
        const wf = await ws.waveform(clip, 2000, true);
        return wf?.rms?.length ? { peak: wf.rms, seconds: wf.seconds } : null;
      } catch {
        return null; // no envelope yet, or a clip nothing can decode — the command says so
      }
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
    // A process backs up each render here before overwriting it, feeding the recordChange journal.
    snapshot,
  };
}

/**
 * Commands that need no active project: the rig preferences, and the whole-repo git ones.
 *
 * The git verbs are `project commit` and `project pull` — this listed a bare `commit|pull`,
 * which matches NEITHER, so both were refused with "no project" whenever none was open. It
 * went unnoticed because st0's command bar always has one; pl8 creating a project it never
 * opens is the first caller to arrive without.
 *
 * These are VERBS FROM `commands.yaml`, and this list has drifted from it once already —
 * check there before adding to it.
 */
const GLOBAL_COMMAND = /^(channel|audio|project (commit|pull))\b/;

/**
 * The lines a command produced, plus whether it REFUSED.
 *
 * An array with a flag on it, rather than a `{ lines, refused }` pair: every writer in this file
 * already pushes into it, and a reply is one verdict — a handler that refuses returns. Optional,
 * so "did not refuse" and "no verdict yet" are the same absence, which is what they are.
 */
export type CommandOutput = string[] & { refused?: boolean };

/**
 * What a run answers: the lines, and the revision either side of the write.
 *
 * The tokens are `recordChange`'s, passed straight through — it brackets the mutation and walked
 * the tree twice to journal it, so it can name both instants for nothing. The route needs them
 * for two things, and used to take a walk of its own for each: whether the project CHANGED
 * (`after !== before`), and the token it hands the browser so the poll has nothing left to say.
 */
export interface WebCommandRun {
  output: CommandOutput;
  before: string;
  after: string;
}

export async function runWebCommand(
  ws: Workspace,
  line: string,
  userEmail?: string,
  // The folder the verbs act on, when the caller means something other than the open project —
  // the chains builder's template. Absolute; the route resolves and checks it.
  at?: string,
): Promise<WebCommandRun> {
  const out: CommandOutput = [];
  // A refusal too, and the first one a caller meets: there is no project open, so the verb has
  // nothing to act on. It read as ordinary output for as long as everything did.
  if (!at && !ws.activeProjectPath() && !GLOBAL_COMMAND.test(line.trim())) {
    const no: CommandOutput = [NO_PROJECT];
    no.refused = true;
    // Nothing ran, so the two instants are one. Free: with no project open the token is
    // `none:<mutations>` and no walk happens.
    const rev = ws.revision().rev;
    return { output: no, before: rev, after: rev };
  }
  // Journal whatever files the command changes, so Ctrl+Z can undo it (a no-op when nothing changed).
  const { before, after } = await ws.recordChange(line, async (snapshot) => {
    try {
      await runCommand(
        line,
        makeHost(ws, out, userEmail, snapshot, at),
        SURFACE,
      );
    } catch (e) {
      out.push(`error: ${(e as Error).message}`);
    }
  });
  return { output: out, before, after };
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
      // The trailing user args in order, each with the class of thing it names, so the palette can colour its
      // field — and the PROVIDER it completes from, which is the precise type a context menu matches on.
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
