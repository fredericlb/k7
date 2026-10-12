// supervisor.ts — the C++ supervisor as a child over NDJSON on stdio, the way the tray runs it (engine/st0-supervisor/docs/hostProtocol.md).
// Its stdin closing is what stops it, so the pipe stays open for the app's whole life.

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { line, relay } from "@studio/electron-shell/log";

/** Not the tray's 8765: the supervisor adopts whatever engine already listens on its port. */
export const ENGINE_PORT = 8766;

export class Supervisor {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private lastStatus = "";

  constructor(
    private readonly bin: string,
    private readonly home: string,
    private readonly registryUrl: string,
  ) {}

  start(): void {
    mkdirSync(this.home, { recursive: true });
    const settings = join(this.home, "engine-host.json");
    // First run only: after that the file is the supervisor's, edited through its own commands.
    if (!existsSync(settings))
      writeFileSync(
        settings,
        JSON.stringify(
          { registryUrls: [this.registryUrl], port: ENGINE_PORT },
          null,
          2,
        ),
      );
    line("supervisor", `starting ${this.bin}`);
    const child = spawn(this.bin, [], {
      env: {
        ...process.env,
        STUDIO_HOME: this.home,
        // No Downloads tab here to choose in, so every instrument is fetched (engine/st0-supervisor/docs/instruments.md).
        STUDIO_INSTRUMENTS: "all",
        STUDIO_REGISTRY_URL: this.registryUrl,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stderr?.on("data", relay("supervisor"));
    if (child.stdout)
      createInterface({ input: child.stdout }).on("line", (l) =>
        this.onFrame(l),
      );
    child.on("exit", (code, signal) =>
      line("supervisor", `exited (${code ?? signal})`),
    );
    child.on("error", (e) =>
      line("supervisor", `could not start: ${e.message}`),
    );
  }

  private onFrame(raw: string): void {
    let frame: {
      t?: string;
      status?: unknown;
      title?: string;
      body?: string;
      ok?: boolean;
      message?: string;
    };
    try {
      frame = JSON.parse(raw);
    } catch {
      line("supervisor", raw);
      return;
    }
    if (frame.t === "state") {
      const status = JSON.stringify(frame.status ?? null);
      if (status !== this.lastStatus) line("supervisor", `status ${status}`);
      this.lastStatus = status;
    } else if (frame.t === "notify")
      line("supervisor", `${frame.title}: ${frame.body}`);
    else if (frame.t === "result" && !frame.ok)
      line("supervisor", `command failed: ${frame.message}`);
  }

  send(cmd: string, arg?: string): void {
    const stdin = this.child?.stdin;
    if (!stdin?.writable) return;
    stdin.write(
      `${JSON.stringify({ t: "cmd", id: this.nextId++, cmd, ...(arg === undefined ? {} : { arg }) })}\n`,
    );
  }

  /** `shutdown`, then the pipe closing: it deregisters and stops the engine; a hung one is killed after the grace. */
  async stop(graceMs = 4_000): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    // Read BEFORE the teardown, which removes the pidfile.
    const engine = this.enginePid();
    const exited = new Promise<void>((r) => child.once("exit", () => r()));
    this.send("shutdown");
    child.stdin?.end();
    await Promise.race([exited, new Promise((r) => setTimeout(r, graceMs))]);
    if (child.exitCode === null) child.kill("SIGKILL");
    // The supervisor returns while its engine is still closing its audio device; give it that time.
    for (let i = 0; i < 20 && engine && alive(engine); i++)
      await new Promise((r) => setTimeout(r, 100));
    if (engine && alive(engine)) {
      line("supervisor", `engine ${engine} outlived the teardown — killed`);
      process.kill(engine, "SIGKILL");
    }
  }

  private enginePid(): number | null {
    try {
      const pid = Number.parseInt(
        readFileSync(join(this.home, "engine.pid"), "utf8"),
        10,
      );
      return pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
