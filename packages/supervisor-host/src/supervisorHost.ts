// supervisorHost.ts — engine/k7-supervisor as a child over NDJSON on stdio, kept running: relaunched on 1s→30s backoff.
// Its stdin closing is what stops it, so the pipe stays open for the host's whole life. See docs/shell.md.

import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { createInterface } from "node:readline";
import { line } from "@frediverse/electron-shell/log";
import {
  checkPid,
  inspectPid,
  killTree,
  type PidRecord,
  parsePidFile,
  pidAlive,
} from "./enginePid.ts";
import {
  commandLine,
  type NotifyFrame,
  parseFrame,
  type Snapshot,
  snapshotOf,
} from "./hostProtocol.ts";

export interface SupervisorHostOptions {
  bin: string;
  /** Merged over this process's environment. */
  env?: Record<string, string>;
  /** The supervisor's `engine.pid`, read at stop to kill an engine that outlived the teardown. */
  enginePidFile?: string;
  /** Where the host's own lines and the supervisor's stderr go; electron-shell's log writer by default (a file, no Electron). */
  log?: (text: string) => void;
  onSnapshot?: (s: Snapshot) => void;
  onNotify?: (n: NotifyFrame) => void;
  /** Down between launches, with why; `null` once one is up again. */
  onDown?: (why: string | null) => void;
  /** Backoff bounds, in ms; tests shorten them. */
  backoff?: { first: number; max: number; resetAfter: number };
}

const BACKOFF = { first: 1_000, max: 30_000, resetAfter: 20_000 };

export class SupervisorHost {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private stopping = false;
  private delay: number;
  private relaunch: NodeJS.Timeout | null = null;
  private readonly backoff: typeof BACKOFF;

  private readonly log: (text: string) => void;

  constructor(private readonly opts: SupervisorHostOptions) {
    this.backoff = opts.backoff ?? BACKOFF;
    this.delay = this.backoff.first;
    this.log = opts.log ?? ((text) => line("supervisor", text));
  }

  start(): void {
    this.stopping = false;
    this.launch();
  }

  private launch(): void {
    this.relaunch = null;
    const started = Date.now();
    this.log(`starting supervisor: ${this.opts.bin}`);
    const child = spawn(this.opts.bin, [], {
      env: {
        ...process.env,
        ...this.opts.env,
        STUDIO_HOST_PID: String(process.pid),
      },
      stdio: ["pipe", "pipe", "pipe"],
      // Out of libuv's job, whose silent breakaway would let the engine escape; the supervisor's own job covers both.
      detached: process.platform === "win32",
      windowsHide: true,
    });
    this.child = child;
    // A write to a supervisor that just died is an EPIPE on this stream, which unheard would end the app.
    child.stdin?.on("error", (e) => this.log(`supervisor stdin: ${e.message}`));
    child.stderr?.on("data", (chunk: Buffer) => {
      for (const l of chunk.toString("utf8").split(/\r?\n/))
        if (l.trim()) this.log(l);
    });
    if (child.stdout)
      createInterface({ input: child.stdout }).on("line", (l) =>
        this.onLine(l),
      );
    // `exit` is the process's own end, which a pipe held open by a surviving engine cannot delay.
    child.once("exit", (code, signal) => {
      this.log(`supervisor exited (${code ?? signal})`);
      this.ended(started);
    });
    child.once("error", (e) => {
      this.log(`could not start supervisor: ${e.message}`);
      this.opts.onDown?.(`supervisor won't start: ${e.message}`);
      // A spawn that failed emits no `exit`.
      if (child.pid === undefined) this.ended(started);
    });
    if (child.pid !== undefined) this.log(`supervisor up (pid ${child.pid})`);
  }

  private ended(started: number): void {
    this.child = null;
    if (this.stopping) return;
    // One that ran a while and died is a one-off; one that dies at once is broken and would bury the log.
    if (Date.now() - started > this.backoff.resetAfter)
      this.delay = this.backoff.first;
    this.opts.onDown?.("supervisor restarting…");
    this.relaunch = setTimeout(() => this.launch(), this.delay);
    this.delay = Math.min(this.delay * 2, this.backoff.max);
  }

  private onLine(raw: string): void {
    if (!raw.trim()) return;
    const frame = parseFrame(raw);
    if (!frame) this.log(raw);
    else if (frame.t === "state") {
      // A snapshot arriving IS the supervisor working, so whatever was last complained about is over.
      this.opts.onDown?.(null);
      this.opts.onSnapshot?.(snapshotOf(frame));
    } else if (frame.t === "notify") this.opts.onNotify?.(frame);
    else if (!frame.ok)
      this.log(`command failed: ${frame.message ?? frame.id}`);
  }

  /** Fire-and-forget; a reply comes back as a `result` frame, surfaced only on failure. */
  send(cmd: string, arg?: string): void {
    const stdin = this.child?.stdin;
    if (!stdin?.writable) {
      this.log(`dropped \`${cmd}\` — supervisor is down`);
      return;
    }
    stdin.write(commandLine(this.nextId++, cmd, arg));
  }

  /** `shutdown`, then the pipe closing: it deregisters and stops the engine; a hung one is killed after the grace. */
  async stop(graceMs = 4_000): Promise<void> {
    this.stopping = true;
    if (this.relaunch) clearTimeout(this.relaunch);
    this.relaunch = null;
    // Read BEFORE the teardown, which removes the pidfile.
    const engine = this.enginePid();
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((r) => child.once("exit", () => r()));
      this.send("shutdown");
      child.stdin?.end();
      await Promise.race([exited, sleep(graceMs)]);
      // The supervisor alone: what it left running is the engine, which the backstop below reaches.
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
    // Also when the supervisor had already crashed: an engine that survives the app is adopted by nobody next launch.
    for (let i = 0; i < 20 && engine && pidAlive(engine.pid); i++)
      await sleep(100);
    if (!engine || !pidAlive(engine.pid)) return;
    const verdict = checkPid(engine, inspectPid(engine.pid), true);
    if (verdict !== "same") {
      this.log(
        `pid ${engine.pid} outlived the teardown, but the pidfile does not prove it is the engine — left alone`,
      );
      return;
    }
    this.log(`engine ${engine.pid} outlived the teardown — killed`);
    killTree(engine.pid);
    if (this.opts.enginePidFile)
      rmSync(this.opts.enginePidFile, { force: true });
  }

  private enginePid(): PidRecord | null {
    if (!this.opts.enginePidFile) return null;
    try {
      return parsePidFile(readFileSync(this.opts.enginePidFile, "utf8"));
    } catch {
      return null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
