// supervisorLink.ts — the supervisor, running IN this process. It replaces a spawned child
// and an NDJSON pipe with two function calls, and it is a third front end over the same
// `startSupervisor` that `cli.ts` uses — not a second implementation. What it must supply
// that a vendored node supplied for free: the bundle's location, and a network stack that
// reads the OS certificate store. See docs/supervisor.md.

import type {
  HostCommand,
  HostCommandName,
  HostEvent,
  HostSnapshot,
  HostTransport,
  NotifyKind,
} from "@studio/engine-host/hostProtocol";
import { startSupervisor } from "@studio/engine-host/supervisor";
import { net } from "electron";
import { line } from "./logbus.ts";

/** What the view does with what arrives. Kept as callbacks so this file knows no window. */
export interface HostHandlers {
  onSnapshot(snapshot: HostSnapshot): void;
  onNotify(kind: NotifyKind, title: string, body: string): void;
  /** A sentence for the status line, or null to clear it. */
  onHostError(message: string | null): void;
}

/** How long the teardown gets before the app stops waiting on it — a hung registry must not hold Quit open. */
const SHUTDOWN_GRACE_MS = 3_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export class SupervisorLink {
  private deliver: ((cmd: HostCommand) => void) | null = null;
  private end: (() => void) | null = null;
  private nextId = 1;
  private stopped: (() => void) | null = null;
  private done: Promise<void> | null = null;

  constructor(
    private readonly handlers: HostHandlers,
    /** Where the staged bundle is, or null in a dev run — see @studio/engine-host bundle.ts. */
    private readonly bundleRoot: string | null,
    /** …and the checkout, or null when packaged. Bundled, we cannot walk up from our own path. */
    private readonly repoRoot: string | null,
  ) {}

  /** Start it. Returns at once; a failure to start is reported through `onHostError`. */
  start(): void {
    this.done = new Promise((r) => {
      this.stopped = r;
    });
    line("host", "starting supervisor (in process)");
    void startSupervisor({
      own: { engine: true, fileService: true, engineQueries: true },
      transport: this.transport(),
      bundleRoot: this.bundleRoot,
      repoRoot: this.repoRoot,
      // Chromium's stack, not node's: a registry behind a local proxy with a private CA is
      // routine, and that CA lives in the OS store, which only this one reads.
      fetch: (input, init) => net.fetch(input as string, init),
      // Ours to end, not its: `process.exit` here would cut `before-quit` short.
      exit: () => this.stopped?.(),
    }).catch((e: unknown) => {
      // LOUD: an app supervising nothing looks exactly like a healthy one.
      const why = e instanceof Error ? e.message : String(e);
      line("host", `supervisor did not start: ${why}`);
      this.handlers.onHostError(why);
      this.stopped?.();
    });
  }

  /** Send a command. A no-op before the supervisor has begun listening, which is only ever brief. */
  send(cmd: HostCommandName, arg?: string): void {
    if (!this.deliver) {
      line("host", `dropped \`${cmd}\` — the supervisor is not listening yet`);
      return;
    }
    const id = this.nextId++;
    this.deliver(
      arg === undefined ? { t: "cmd", id, cmd } : { t: "cmd", id, cmd, arg },
    );
  }

  /**
   * Ask it to shut down and wait, BEFORE tearing down anything of our own: it deregisters on
   * its way out, and that wants to happen while the engine is still up. Bounded, because one
   * stuck on an unresponsive registry must not hold the app open — pidkill's backstop is what
   * catches whatever it left behind.
   */
  async shutdownAndWait(): Promise<void> {
    if (!this.done) return;
    // The command first, then the channel ending — the same two the pipe used to carry.
    this.send("shutdown");
    this.end?.();
    await Promise.race([this.done, sleep(SHUTDOWN_GRACE_MS)]);
  }

  /** The transport `startSupervisor` writes to, with nothing serialised in between. */
  private transport(): HostTransport {
    return {
      emit: (event: HostEvent) => this.onEvent(event),
      listen: (onCommand, onEnd) => {
        this.deliver = onCommand;
        this.end = onEnd;
        // The dev launcher waits for this line to know the app came up — scripts/appProcess.mjs.
        line("host", "supervisor up");
      },
    };
  }

  private onEvent(frame: HostEvent): void {
    switch (frame.t) {
      case "state":
        this.handlers.onSnapshot(frame);
        break;
      case "notify":
        this.handlers.onNotify(frame.kind, frame.title, frame.body);
        break;
      case "result":
        if (!frame.ok)
          line("host", `command failed: ${frame.message ?? "command failed"}`);
        break;
    }
  }
}
