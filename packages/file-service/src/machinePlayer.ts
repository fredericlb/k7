// machinePlayer.ts — play a cached song through THIS machine's own outputs, without the
// moteur: one mpv per person, driven over its JSON IPC socket. For a headless box that is a
// player and not an instrument. See docs/machinePlayer.md.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import { mediatekRoot } from "@studio/song/mediatekRoot";
import { rootDir, slugify } from "./slug.ts";

/** `--ao=alsa` by default, since a headless session starts no sound server — see docs/machinePlayer.md. */
const AO = process.env.STUDIO_PLAYER_AO || "alsa";

const bin = (): string => process.env.MPV_BIN || "mpv";

/** An IPC command silent past this is lost: mpv answers in microseconds, so longer means it is gone. */
const IPC_TIMEOUT_MS = 2000;

/** What the bottom bar needs to know. */
export interface PlayerState {
  /** The médiathèque-relative path that was asked for, or null when nothing is loaded. */
  path: string | null;
  playing: boolean;
  /** Seconds, or 0 until mpv has read the header. */
  position: number;
  duration: number;
  /** mpv has nothing left to play — the end of a track, or nothing was ever loaded. */
  idle: boolean;
}

const EMPTY: PlayerState = {
  path: null,
  playing: false,
  position: 0,
  duration: 0,
  idle: true,
};

/** The absolute path of a track here, from a RELATIVE one; a `..` is refused rather than normalised. */
export function resolveInMediatek(rel: string): string {
  if (!rel || isAbsolute(rel)) throw new Error("chemin relatif attendu");
  const root = mediatekRoot();
  const abs = normalize(join(root, rel));
  const inside = relative(root, abs);
  if (inside.startsWith("..") || isAbsolute(inside))
    throw new Error("chemin hors de la médiathèque");
  if (!existsSync(abs)) throw new Error(`${rel} n'est pas sur cette machine`);
  return abs;
}

interface Player {
  socketPath: string;
  /** What was asked for, which mpv cannot report: it knows only its absolute path. */
  wanted: string | null;
  ipc: Socket | null;
  nextId: number;
  pending: Map<number, (v: unknown) => void>;
  buffer: string;
}

const players = new Map<string, Player>();

const socketFor = (slug: string): string => {
  const dir = join(rootDir(), "mpv");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${slug}.sock`);
};

/** Open — or reopen — the IPC connection; `null` when mpv is not there, which makes the caller start it. */
function dial(p: Player): Promise<Socket | null> {
  return new Promise((resolve) => {
    const s = connect(p.socketPath);
    const done = (v: Socket | null) => {
      s.removeAllListeners("connect");
      s.removeAllListeners("error");
      resolve(v);
    };
    s.once("connect", () => {
      p.buffer = "";
      // One line is one message: mpv splits on `\n` and on nothing else.
      s.on("data", (chunk) => {
        p.buffer += chunk.toString("utf8");
        for (;;) {
          const cut = p.buffer.indexOf("\n");
          if (cut < 0) break;
          const line = p.buffer.slice(0, cut);
          p.buffer = p.buffer.slice(cut + 1);
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line) as {
              request_id?: number;
              data?: unknown;
            };
            if (typeof msg.request_id === "number") {
              p.pending.get(msg.request_id)?.(msg.data);
              p.pending.delete(msg.request_id);
            }
            // Events are ignored: state is READ on demand, so neither side has to track it.
          } catch {
            /* an unreadable line is no reason to close */
          }
        }
      });
      s.on("close", () => {
        p.ipc = null;
        // Nobody will answer now: release the waiters rather than time them out one by one.
        for (const [, r] of p.pending) r(undefined);
        p.pending.clear();
      });
      s.on("error", () => s.destroy());
      done(s);
    });
    s.once("error", () => done(null));
  });
}

/** Start mpv idle: `--idle` makes it wait for a `loadfile` instead of exiting. */
function spawnMpv(p: Player): void {
  const child = spawn(
    bin(),
    [
      "--idle=yes",
      "--no-video",
      "--no-terminal",
      `--ao=${AO}`,
      // No user config or scripts: this process is an organ of the service, not somebody's mpv.
      "--no-config",
      `--input-ipc-server=${p.socketPath}`,
    ],
    { stdio: "ignore", detached: false },
  );
  child.on("error", () => {
    /* not on PATH — `command()` will say so on the next call */
  });
  child.unref();
}

/** Wait for the socket to answer: mpv creates it a moment after starting. */
async function ensure(p: Player): Promise<Socket> {
  if (p.ipc && !p.ipc.destroyed) return p.ipc;
  let s = await dial(p);
  if (!s) {
    spawnMpv(p);
    for (let i = 0; i < 40 && !s; i++) {
      await new Promise((r) => setTimeout(r, 50));
      s = await dial(p);
    }
  }
  if (!s)
    throw new Error(
      `mpv n'a pas démarré sur cette machine (${bin()}) — est-il installé ?`,
    );
  p.ipc = s;
  return s;
}

function playerFor(userEmail: string): Player {
  const slug = slugify(userEmail);
  let p = players.get(slug);
  if (!p) {
    p = {
      socketPath: socketFor(slug),
      wanted: null,
      ipc: null,
      nextId: 1,
      pending: new Map(),
      buffer: "",
    };
    players.set(slug, p);
  }
  return p;
}

/** One command and its answer; `undefined` is "not yet" rather than an error. */
async function command(p: Player, args: unknown[]): Promise<unknown> {
  const s = await ensure(p);
  const id = p.nextId++;
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      p.pending.delete(id);
      resolve(undefined);
    }, IPC_TIMEOUT_MS);
    p.pending.set(id, (v) => {
      clearTimeout(t);
      resolve(v);
    });
    s.write(`${JSON.stringify({ command: args, request_id: id })}\n`);
  });
}

const get = (p: Player, name: string): Promise<unknown> =>
  command(p, ["get_property", name]);

/** Does mpv exist on this machine at all? Probed on demand, like yt-dlp. */
export async function playerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(bin(), ["--version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

export async function play(
  userEmail: string,
  rel: string,
  from = 0,
): Promise<void> {
  const abs = resolveInMediatek(rel);
  const p = playerFor(userEmail);
  // `replace`, not `append`: one thing comes out of the speakers, and the queue lives in the tab.
  await command(p, [
    "loadfile",
    abs,
    "replace",
    // mpv takes start options in the same call, avoiding a seek that would land before the open.
    from > 0 ? { start: String(from) } : {},
  ]);
  await command(p, ["set_property", "pause", false]);
  p.wanted = rel;
}

export async function setPaused(
  userEmail: string,
  paused: boolean,
): Promise<void> {
  await command(playerFor(userEmail), ["set_property", "pause", paused]);
}

export async function seek(userEmail: string, to: number): Promise<void> {
  await command(playerFor(userEmail), [
    "set_property",
    "time-pos",
    Math.max(0, to),
  ]);
}

/** Stop and forget. mpv stays idle: restarting it would cost a process launch per track. */
export async function stop(userEmail: string): Promise<void> {
  const p = playerFor(userEmail);
  await command(p, ["stop"]);
  p.wanted = null;
}

export async function state(userEmail: string): Promise<PlayerState> {
  const p = playerFor(userEmail);
  if (!p.ipc && !existsSync(p.socketPath)) return EMPTY;
  // All at once on the one socket: mpv has no batch command, but nothing forces them to queue.
  const [idle, paused, pos, dur] = await Promise.all([
    get(p, "idle-active"),
    get(p, "pause"),
    get(p, "time-pos"),
    get(p, "duration"),
  ]);
  const isIdle = idle !== false;
  return {
    // What was ASKED FOR: mpv knows only the absolute path, and returning it would expose the tree.
    path: isIdle ? null : p.wanted,
    playing: !isIdle && paused === false && typeof pos === "number",
    position: typeof pos === "number" ? pos : 0,
    duration: typeof dur === "number" ? dur : 0,
    idle: isIdle,
  };
}

/** Exported for the guard's test, which has no business knowing `sep`. */
export const PATH_SEP = sep;
