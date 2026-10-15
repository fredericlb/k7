// instances.ts — one file-service PROCESS per account, started on first use and stopped when
// idle. A process rather than a shared service because the file service holds one person's
// state in module globals (the owner, the pattern clock, the watchers), and a process boundary
// is the one isolation that cannot be forgotten. See docs/fileHub.md.

import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { slugify } from "@studio/engine-client/paths";

/** An account's folder name: readable, and unique per EXACT email — a slug alone folds `a.b@` and `a_b@` together. */
export function accountKey(email: string): string {
  const hash = createHash("sha256").update(email).digest("hex").slice(0, 10);
  return `${slugify(email)}-${hash}`;
}

export interface Instance {
  user: string;
  /** `accountKey(user)`: the account's folder here, and its cache folder on an engine's machine. */
  slug: string;
  /** The account's `$STUDIO_HOME` on this server. */
  home: string;
  port: number;
  secret: string;
  child: ChildProcess;
  lastUsed: number;
  /** The engine this instance drives, and the loopback path the tunnel hub bound for it. */
  engineId: string | null;
  localPath: string | null;
  /** …and the path the same machine takes jobs on — its separations. */
  jobsPath: string | null;
  /** Bindings run one at a time, chained here. */
  binding: Promise<void>;
}

export interface InstancesOptions {
  /** Every account's state lives under here, one folder per account. */
  dataRoot: string;
  /** The shared médiathèque, if this server holds one. */
  mediatekRoot?: string;
  /** Where an account's service calls pl8 back, and the bearer it calls with — minted per account. */
  mediatekLink?: (user: string) => { url: string; token: string };
  /** How to run the file service; the default is tsx over its own source. */
  command?: () => { cmd: string; args: string[]; cwd: string };
  readyTimeoutMs?: number;
  log?: (msg: string) => void;
  /** What the hub adds to an account's instance environment: where the libraries are, how to call it back, where it syncs. */
  env?: (slug: string) => Record<string, string>;
  /** An account whose instance must keep running however idle: it is a replica syncing with a remote relay. */
  keep?: (slug: string) => boolean;
  /** Told when an instance is gone, for the binding it held. */
  onExit?: (inst: Instance) => void;
}

/** tsx over `@studio/file-service`'s entry, resolved from here so the image needs no path configured. */
function defaultCommand(): { cmd: string; args: string[]; cwd: string } {
  // A bundled backend (the Android app) names its bundled file service: there is no tsx and no source.
  const bundled = process.env.STUDIO_FILE_SERVICE_ENTRY;
  if (bundled)
    return { cmd: process.execPath, args: [bundled], cwd: dirname(bundled) };
  const req = createRequire(import.meta.url);
  const pkg = dirname(req.resolve("@studio/file-service/package.json"));
  return {
    cmd: process.execPath,
    args: [req.resolve("tsx/cli"), join(pkg, "src", "server.ts")],
    cwd: pkg,
  };
}

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => res(port));
    });
  });
}

async function waitHealthy(
  port: number,
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (child.exitCode !== null)
      throw new Error(`file service exited (${child.exitCode})`);
    if (child.pid === undefined) throw new Error("file service did not start");
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error(`file service did not answer within ${timeoutMs} ms`);
}

export class Instances {
  private readonly byUser = new Map<string, Promise<Instance>>();
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: InstancesOptions) {
    this.log = opts.log ?? ((m) => console.log(`files | ${m}`));
  }

  /** The account's instance, started if it has none; concurrent callers share one start. */
  get(user: string): Promise<Instance> {
    let p = this.byUser.get(user);
    if (!p) {
      p = this.start(user);
      this.byUser.set(user, p);
      p.catch(() => this.byUser.delete(user));
    }
    return p.then((inst) => {
      inst.lastUsed = Date.now();
      return inst;
    });
  }

  private async start(user: string): Promise<Instance> {
    const slug = accountKey(user);
    const home = join(resolve(this.opts.dataRoot), slug);
    mkdirSync(home, { recursive: true });
    const port = await freePort();
    const secret = randomBytes(32).toString("hex");
    const { cmd, args, cwd } = (this.opts.command ?? defaultCommand)();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      STUDIO_HOME: home,
      STUDIO_FILE_PORT: String(port),
      STUDIO_HUB_SECRET: secret,
      ...this.opts.env?.(slug),
    };
    delete env.STUDIO_ENGINE_TOKEN;
    if (this.opts.mediatekRoot) env.STUDIO_MEDIATEK = this.opts.mediatekRoot;
    const link = this.opts.mediatekLink?.(user);
    if (link) {
      env.MEDIATEK_URL = link.url;
      env.MEDIATEK_TOKEN = link.token;
    }
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const relay = (chunk: Buffer) => {
      for (const l of chunk.toString("utf8").split(/\r?\n/))
        if (l.trim()) this.log(`[${slug}] ${l}`);
    };
    // A spawn that fails emits `error`, which unheard would become the hub's own crash.
    child.on("error", (e) => this.log(`[${slug}] ${e.message}`));
    child.stdout?.on("data", relay);
    child.stderr?.on("data", relay);
    const inst: Instance = {
      user,
      slug,
      home,
      port,
      secret,
      child,
      lastUsed: Date.now(),
      engineId: null,
      localPath: null,
      jobsPath: null,
      binding: Promise.resolve(),
    };
    // An orphan would keep its port and its engine link after the hub is gone.
    const orphanGuard = () => child.kill();
    process.once("exit", orphanGuard);
    child.on("exit", (code) => {
      process.off("exit", orphanGuard);
      this.log(`[${slug}] exited (${code})`);
      void this.byUser.get(user)?.then((current) => {
        if (current === inst) this.byUser.delete(user);
      });
      this.opts.onExit?.(inst);
    });
    await waitHealthy(port, child, this.opts.readyTimeoutMs ?? 60_000);
    this.log(`[${slug}] up on ${port}`);
    return inst;
  }

  /** The running instance that holds `secret`, or null: how an instance calling the hub back is told from a stranger. */
  async bySecret(secret: string): Promise<Instance | null> {
    for (const p of [...this.byUser.values()]) {
      const inst = await p.catch(() => null);
      if (inst && secret && inst.secret === secret) return inst;
    }
    return null;
  }

  /** The instances started and answering now. */
  async running(): Promise<Instance[]> {
    const all = await Promise.all(
      [...this.byUser.values()].map((p) => p.catch(() => null)),
    );
    return all.filter((i): i is Instance => i !== null);
  }

  /** Stop what nobody asked for in `idleMs`; the next request starts it again. */
  async reap(idleMs: number, now = Date.now()): Promise<void> {
    for (const p of [...this.byUser.values()]) {
      const inst = await p.catch(() => null);
      if (inst && now - inst.lastUsed >= idleMs && !this.opts.keep?.(inst.slug))
        inst.child.kill();
    }
  }

  /** Stop the account's instance and start it again, so it reads a changed environment. */
  async restart(user: string): Promise<Instance> {
    const p = this.byUser.get(user);
    this.byUser.delete(user);
    const old = await p?.catch(() => null);
    if (old && old.child.exitCode === null) {
      const gone = new Promise((r) => old.child.once("exit", r));
      old.child.kill();
      await gone;
    }
    return this.get(user);
  }

  async stopAll(): Promise<void> {
    for (const p of [...this.byUser.values()])
      (await p.catch(() => null))?.child.kill();
  }
}
