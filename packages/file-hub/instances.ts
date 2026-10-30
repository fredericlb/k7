// instances.ts — one file-service PROCESS per account, started on first use and stopped when
// idle. A process rather than a shared service because the file service holds one person's
// state in module globals (the owner, the pattern clock, the watchers), and a process boundary
// is the one isolation that cannot be forgotten. The count is CAPPED and a crashing account is
// held off by a backoff: a start refused throws `Unavailable`, answered 503. Where no process may be started
// (an iOS app), each runs on a worker thread instead, which keeps the same isolation (workerChild.ts).
// How a child is started and stopped is serviceChild.ts. See docs/fileHub.md.

import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { slugify } from "@studio/engine-client/paths";
import { HUB_SECRET_HEADER } from "@studio/web-protocol";
import { instanceCap } from "./capacity.ts";
import { freePort } from "./ports.ts";
import {
  defaultCommand,
  type ServiceChild,
  STDIN_STOP_ENV,
  spawnService,
  stopChild,
  threadEntryFromEnv,
} from "./serviceChild.ts";
import { serviceEnv } from "./serviceEnv.ts";

export {
  type ServiceChild,
  type Stoppable,
  stopChild,
} from "./serviceChild.ts";

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
  child: ServiceChild;
  lastUsed: number;
  /** The engine this instance drives, and the loopback path the tunnel hub bound for it. */
  engineId: string | null;
  localPath: string | null;
  /** …and the path the same machine takes jobs on — its separations. */
  jobsPath: string | null;
  /** Bindings run one at a time, chained here. */
  binding: Promise<void>;
  /** Requests forwarded and not answered yet: an instance with any is never stopped for idleness. */
  inflight: number;
  /** Set when the hub stops it itself, so that exit is not counted as a crash. */
  stopping: boolean;
  startedAt: number;
}

/** A start refused, for the cap or for a crash backoff: the route answers 503 with `Retry-After`. */
export class Unavailable extends Error {
  constructor(
    message: string,
    readonly retryAfterS: number,
  ) {
    super(message);
  }
}

/** An instance nobody called for this long may be stopped to make room for another account. */
const EVICT_IDLE_MS = 2 * 60_000;
/** The first and the longest wait before a crashed account's service is started again. */
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;
/** A service that ran this long before it exited starts its backoff over. */
const HEALTHY_MS = 60_000;
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
  /** The cap on instances; default `instanceCap()`, from `STUDIO_MAX_FILE_SERVICES` or the memory limit. */
  maxInstances?: number;
  evictIdleMs?: number;
  backoffMinMs?: number;
  backoffMaxMs?: number;
  healthyMs?: number;
  /** How long a child asked to stop gets before it is killed; default STOP_GRACE_MS. */
  stopGraceMs?: number;
  /** Tests only: the port a new child is handed, to force the free-port race. */
  pickPort?: () => Promise<number>;
  /** Run each file service on a worker thread from this plain-JS entry, not as a process; default `threadEntryFromEnv()`. */
  threadEntry?: string;
}

class ForeignPort extends Error {}

/** Ready when the port answers a GATED probe with this child's secret: another account's service answers 401. */
async function waitHealthy(
  port: number,
  secret: string,
  child: ServiceChild,
  timeoutMs: number,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (child.exitCode !== null)
      throw new Error(`file service exited (${child.exitCode})`);
    if (child.pid === undefined) throw new Error("file service did not start");
    let status = 0;
    try {
      status = (
        await fetch(`http://127.0.0.1:${port}/hub/ready`, {
          headers: { [HUB_SECRET_HEADER]: secret },
        })
      ).status;
    } catch {
      /* not listening yet */
    }
    if (status === 401) {
      child.kill();
      throw new ForeignPort(`port ${port} answers with another secret`);
    }
    if (status > 0 && status < 500) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error(`file service did not answer within ${timeoutMs} ms`);
}

/** What a readiness probe reads of the hub: how full it is, and whether a start is stuck. */
export interface InstancesStatus {
  running: number;
  starting: number;
  cap: number;
  /** How long the oldest start still waiting has waited, 0 when none is. */
  oldestStartMs: number;
  lastStartError: { at: number; message: string } | null;
}

interface Crashes {
  count: number;
  /** No start before this time. */
  until: number;
}

export class Instances {
  private readonly byUser = new Map<string, Promise<Instance>>();
  /** The same instances once started: what eviction picks from, synchronously. */
  private readonly live = new Map<string, Instance>();
  private readonly crashes = new Map<string, Crashes>();
  private readonly log: (msg: string) => void;
  private readonly max: number;
  /** Each start still waiting for its child to answer, by when it began. */
  private readonly starting = new Map<string, number>();
  private lastStartError: InstancesStatus["lastStartError"] = null;
  /** Set by `stopAll`: no kept account is started again after it. */
  private closed = false;

  constructor(private readonly opts: InstancesOptions) {
    this.log = opts.log ?? ((m) => console.log(`files | ${m}`));
    this.max = opts.maxInstances ?? instanceCap();
  }

  /** The account's instance, started if it has none; concurrent callers share one start. */
  get(user: string): Promise<Instance> {
    let p = this.byUser.get(user);
    if (!p) {
      const refused = this.refusal(user);
      if (refused) return Promise.reject(refused);
      p = this.start(user);
      this.byUser.set(user, p);
      p.catch(() => {
        if (this.byUser.get(user) === p) this.byUser.delete(user);
      });
    }
    return p.then((inst) => {
      inst.lastUsed = Date.now();
      return inst;
    });
  }

  /** `get`, counted in flight until the returned release is called: what a forwarded request holds. */
  async hold(user: string): Promise<{ inst: Instance; release: () => void }> {
    const inst = await this.get(user);
    inst.inflight++;
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      inst.inflight--;
      inst.lastUsed = Date.now();
    };
    return { inst, release };
  }

  /** Why no instance may start for `user` now, or null: a backoff running, or the cap reached with nothing to evict. */
  private refusal(user: string, now = Date.now()): Unavailable | null {
    const c = this.crashes.get(user);
    if (c && now < c.until)
      return new Unavailable(
        "the file service keeps exiting; starting it again shortly",
        Math.ceil((c.until - now) / 1000),
      );
    if (this.byUser.size < this.max || this.evictOne(now)) return null;
    return new Unavailable(
      `the server is busy: ${this.max} file services are running and none has been idle long enough to stop`,
      30,
    );
  }

  /** Stop the least recently used instance idle long enough; false when every one is busy or kept. */
  private evictOne(now: number): boolean {
    const idle = this.opts.evictIdleMs ?? EVICT_IDLE_MS;
    let lru: Instance | null = null;
    for (const inst of this.live.values()) {
      if (inst.inflight > 0 || now - inst.lastUsed < idle) continue;
      if (this.opts.keep?.(inst.slug)) continue;
      if (!lru || inst.lastUsed < lru.lastUsed) lru = inst;
    }
    if (!lru) return false;
    this.log(`[${lru.slug}] stopped to make room`);
    void this.stop(lru);
    return true;
  }

  /** Stop an instance on the hub's own account and forget it at once, so the cap counts it gone. */
  private stop(inst: Instance): Promise<void> {
    inst.stopping = true;
    this.forget(inst);
    return stopChild(inst.child, this.opts.stopGraceMs);
  }

  /** `live` holds an instance only while `byUser` holds its start, so both go together. */
  private forget(inst: Instance): void {
    if (this.live.get(inst.user) !== inst) return;
    this.live.delete(inst.user);
    this.byUser.delete(inst.user);
  }

  /** A crash or a failed start pushes the next start back, doubling, unless the last run was a healthy one. */
  private crashed(user: string, ranMs: number): void {
    const min = this.opts.backoffMinMs ?? BACKOFF_MIN_MS;
    const healthy = ranMs >= (this.opts.healthyMs ?? HEALTHY_MS);
    const count = healthy ? 1 : (this.crashes.get(user)?.count ?? 0) + 1;
    const wait = Math.min(
      min * 2 ** (count - 1),
      this.opts.backoffMaxMs ?? BACKOFF_MAX_MS,
    );
    this.crashes.set(user, { count, until: Date.now() + wait });
  }

  /** A kept account's service started again once its backoff ends: with no page open, nothing else would. */
  private revive(user: string): void {
    if (this.closed || !this.opts.keep?.(accountKey(user))) return;
    const until = this.crashes.get(user)?.until ?? 0;
    const min = this.opts.backoffMinMs ?? BACKOFF_MIN_MS;
    const timer = setTimeout(
      () => {
        if (this.closed || this.byUser.has(user)) return;
        this.get(user).catch((e: Error) => {
          this.log(`[${accountKey(user)}] not restarted: ${e.message}`);
          this.revive(user);
        });
      },
      Math.max(min, until - Date.now()),
    );
    timer.unref();
  }

  private async start(user: string): Promise<Instance> {
    const startedAt = Date.now();
    this.starting.set(user, startedAt);
    try {
      const inst = await this.spawn(user);
      this.live.set(user, inst);
      return inst;
    } catch (e) {
      this.lastStartError = { at: Date.now(), message: (e as Error).message };
      // A port another child took is a race, not this account's fault: no backoff for it.
      if (!(e instanceof ForeignPort))
        this.crashed(user, Date.now() - startedAt);
      throw e;
    } finally {
      if (this.starting.get(user) === startedAt) this.starting.delete(user);
    }
  }

  /** How full the hub is and how its starts are going, for the readiness probe. */
  status(now = Date.now()): InstancesStatus {
    let oldest = now;
    for (const t of this.starting.values()) oldest = Math.min(oldest, t);
    return {
      running: this.live.size,
      starting: this.starting.size,
      cap: this.max,
      oldestStartMs: now - oldest,
      lastStartError: this.lastStartError,
    };
  }

  private async spawn(user: string): Promise<Instance> {
    const slug = accountKey(user);
    const home = join(resolve(this.opts.dataRoot), slug);
    mkdirSync(home, { recursive: true });
    const port = await (this.opts.pickPort ?? freePort)();
    const secret = randomBytes(32).toString("hex");
    const env: NodeJS.ProcessEnv = {
      ...serviceEnv(process.env),
      [STDIN_STOP_ENV]: "1",
      STUDIO_HOME: home,
      STUDIO_FILE_PORT: String(port),
      STUDIO_HUB_SECRET: secret,
      ...this.opts.env?.(slug),
    };
    if (this.opts.mediatekRoot) env.STUDIO_MEDIATEK = this.opts.mediatekRoot;
    const link = this.opts.mediatekLink?.(user);
    if (link) {
      env.MEDIATEK_URL = link.url;
      env.MEDIATEK_TOKEN = link.token;
    }
    const child = spawnService(
      (this.opts.command ?? defaultCommand)(),
      env,
      this.opts.threadEntry ?? threadEntryFromEnv(),
    );
    // A child that already exited closed its end first.
    child.stdin?.on("error", () => {});
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
      inflight: 0,
      stopping: false,
      startedAt: Date.now(),
    };
    let up = false;
    child.on("exit", (code) => {
      this.log(`[${slug}] exited (${code})`);
      this.forget(inst);
      // A failed start is counted by `start`; only a running service that died on its own is counted here.
      if (up && !inst.stopping) {
        this.crashed(user, Date.now() - inst.startedAt);
        this.revive(user);
      }
      this.opts.onExit?.(inst);
    });
    await waitHealthy(port, secret, child, this.opts.readyTimeoutMs ?? 60_000);
    up = true;
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

  /** Stop what nobody asked for in `idleMs` and has nothing in flight; the next request starts it again. */
  async reap(idleMs: number, now = Date.now()): Promise<void> {
    for (const inst of [...this.live.values()])
      if (
        inst.inflight === 0 &&
        now - inst.lastUsed >= idleMs &&
        !this.opts.keep?.(inst.slug)
      )
        void this.stop(inst);
  }

  /** Stop the account's instance and start it again, so it reads a changed environment. */
  async restart(user: string): Promise<Instance> {
    const p = this.byUser.get(user);
    this.byUser.delete(user);
    const old = await p?.catch(() => null);
    if (old) {
      // Forgotten here and not through `stop`, which would drop a start a concurrent `get` made meanwhile.
      if (this.live.get(user) === old) this.live.delete(user);
      old.stopping = true;
      await stopChild(old.child, this.opts.stopGraceMs);
    }
    this.crashes.delete(user);
    return this.get(user);
  }

  /** Ask every instance to stop, all at once, and resolve when each has exited or been killed. */
  async stopAll(): Promise<void> {
    this.closed = true;
    const all = await Promise.all(
      [...this.byUser.values()].map((p) => p.catch(() => null)),
    );
    await Promise.all(
      all.filter((i): i is Instance => i !== null).map((i) => this.stop(i)),
    );
  }
}
