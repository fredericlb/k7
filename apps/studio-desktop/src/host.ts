// host.ts — the NDJSON link to @studio/engine-host: spawn it, read its frames, send it
// commands, and keep it alive across crashes. There is NO hand-written mirror of the
// protocol here — the types come from the supervisor's own hostProtocol.ts, which is what
// stops the two ends drifting. The supervisor computes every policy; this file only carries
// its frames. See docs/tray.md.

import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type {
  HostCommandName,
  HostEvent,
  HostSnapshot,
  NotifyKind,
} from "@studio/engine-host/hostProtocol";
import type { HostCmd } from "./hostCmd.ts";
import { assign } from "./job.ts";
import { line, pump } from "./logbus.ts";

/** What the view does with what arrives. Kept as callbacks so this file knows no tray. */
export interface HostHandlers {
  onSnapshot(snapshot: HostSnapshot): void;
  onNotify(kind: NotifyKind, title: string, body: string): void;
  /** A sentence for the status line, or null to clear it. */
  onHostError(message: string | null): void;
}

/**
 * The supervisor's "restart me now" exit code — it saw its own source change (dev only;
 * mirrored from devReload.ts). It exists to keep the crash backoff out of the way: two quick
 * edits would otherwise leave a dev waiting 4s, then 8s, for a relaunch recovering from nothing.
 */
const RELOAD_EXIT_CODE = 77;

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
/** A supervisor that ran this long before dying is a one-off, not a broken one. */
const STABLE_MS = 20_000;
const SHUTDOWN_GRACE_MS = 3_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export class HostLink {
  private child: ChildProcess | null = null;
  private nextId = 1;
  /** Set by shutdownAndWait, so the relaunch loop knows an exit was intended. */
  private stopping = false;

  /**
   * `cmd` is resolved ONCE by the caller and never re-resolved: resolution is static, so a
   * second attempt fails identically. null is the loud "supervisor not found" case.
   */
  constructor(
    private readonly handlers: HostHandlers,
    private readonly cmd: HostCmd | null,
  ) {}

  /** Start the supervisor and keep it running. Returns at once; the loop runs detached. */
  start(): void {
    void this.runForever();
  }

  private async runForever(): Promise<void> {
    const cmd = this.cmd;
    if (!cmd) {
      // LOUD on purpose: an app supervising nothing looks exactly like a healthy one.
      line("host", "supervisor not found (no bundle, no repo tsx)");
      this.handlers.onHostError("supervisor not found");
      return;
    }

    let backoff = MIN_BACKOFF_MS;
    for (;;) {
      const started = Date.now();
      line("host", `starting supervisor: ${cmd.program}`);

      let code: number | null;
      try {
        code = await this.launch(cmd);
      } catch (e) {
        line("host", `could not start supervisor: ${String(e)}`);
        this.handlers.onHostError(`supervisor won't start: ${String(e)}`);
        code = null;
      }

      if (this.stopping) return;

      // A deliberate dev reload is not a failure: relaunch at once, backoff untouched.
      if (code === RELOAD_EXIT_CODE) {
        this.handlers.onHostError("supervisor reloading…");
        continue;
      }

      if (Date.now() - started > STABLE_MS) backoff = MIN_BACKOFF_MS;
      this.handlers.onHostError("supervisor restarting…");
      await sleep(backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }

  /** Run one supervisor to completion, resolving with its exit code when the pipe closes. */
  private launch(cmd: HostCmd): Promise<number | null> {
    const child = spawn(cmd.program, cmd.args, {
      stdio: ["pipe", "pipe", "pipe"],
      // node is a console subprocess and this app is windowless, so Windows would pop a terminal.
      windowsHide: true,
    });
    this.child = child;

    // The ONLY assign call: the supervisor starts the rest, and a job member's children
    // join the job automatically, so the engine and the file service are covered for free.
    assign(child);

    if (child.stderr) pump(child.stderr, "host");
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout });
      rl.on("line", (text) => this.onLine(text));
    }
    line("host", `supervisor up (pid ${child.pid})`);

    return new Promise((resolveExit, rejectExit) => {
      child.on("error", (e) => {
        this.child = null;
        rejectExit(e);
      });
      child.on("close", (code) => {
        this.child = null;
        if (code === RELOAD_EXIT_CODE) line("host", "supervisor reloading");
        else line("host", `supervisor exited (${code ?? "signal"})`);
        resolveExit(code);
      });
    });
  }

  private onLine(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    let frame: HostEvent;
    try {
      frame = JSON.parse(trimmed) as HostEvent;
    } catch (e) {
      // Not fatal: an unreadable frame is a protocol bug worth seeing, but dropping the
      // channel would take the app down over a typo.
      line("host", `unreadable frame (${String(e)}): ${trimmed}`);
      return;
    }
    switch (frame.t) {
      case "state":
        this.handlers.onSnapshot(frame);
        break;
      case "notify":
        this.handlers.onNotify(frame.kind, frame.title, frame.body);
        break;
      case "result":
        if (!frame.ok) {
          line("host", `command failed: ${frame.message ?? "command failed"}`);
        }
        break;
    }
  }

  /**
   * Send a command, fire-and-forget: a reply arrives as a `result` frame and is surfaced only
   * on failure. A no-op while the supervisor is down — the relaunch loop fixes that, not the caller.
   */
  send(cmd: HostCommandName, arg?: string): void {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed) {
      line("host", `dropped \`${cmd}\` — supervisor is down`);
      return;
    }
    const id = this.nextId++;
    const payload =
      arg === undefined ? { t: "cmd", id, cmd } : { t: "cmd", id, cmd, arg };
    stdin.write(`${JSON.stringify(payload)}\n`, (err) => {
      // A failed write means the pipe broke; the close handler will start the relaunch.
      if (err) line("host", `lost the pipe while sending \`${cmd}\``);
    });
  }

  /**
   * Ask the supervisor to shut down and wait briefly, BEFORE tearing down anything of our own:
   * it deregisters on its way out, which wants to happen while the engine is still up. Bounded,
   * then killed — one stuck on an unresponsive registry must not hold the app open, and
   * pidkill's backstop cleans up after it.
   */
  async shutdownAndWait(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child) return;

    this.send("shutdown");
    // Closing stdin is the Unix teardown signal, and makes a supervisor that ignored the
    // command exit anyway.
    child.stdin?.end();

    const exited = new Promise<void>((r) => child.once("close", () => r()));
    const timedOut = Symbol("timeout");
    const race = await Promise.race([
      exited.then(() => "exited" as const),
      sleep(SHUTDOWN_GRACE_MS).then(() => timedOut),
    ]);
    if (race === timedOut) {
      // The supervisor ITSELF only, a plain kill: it is our direct child and not a group
      // leader, so signalling a group would reach our own process. What it left running is
      // the engine, which the backstop reaches.
      child.kill();
      await Promise.race([exited, sleep(500)]);
    }
    this.child = null;
  }
}
