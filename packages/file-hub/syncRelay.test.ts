// syncRelay.test.ts — the relay over a real socket: a seed, a newcomer, edits both ways, a restart,
// a machine joining with work of its own, an edit made while a machine was off, and one that lost to a newer value.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LiveCapture } from "@studio/file-service/src/liveCapture.ts";
import { ConfirmedDir } from "@studio/file-service/src/liveConfirmed.ts";
import {
  loadHead,
  RelayLink,
  type RelayAuth,
} from "@studio/file-service/src/liveRelay.ts";
import { isBinary, skip } from "@studio/file-service/src/workspace.ts";
import { Replica } from "@studio/live-sync/replica";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { DeviceTokens } from "./deviceTokens.ts";
import { attachSyncRelay, SYNC_PATH } from "./syncRelay.ts";

const MIX = "plugin: mixer\nparams:\n  gain: 0.5\n  pan: 0\n";
const FILE = "song.st0/nodes/mix.yaml";
const SECRETS = new Set(["secret-a", "secret-b"]);

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0).reverse()) f();
});

function put(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

const read = (root: string, rel: string): string | null => {
  try {
    return readFileSync(join(root, rel), "utf8");
  } catch {
    return null;
  }
};

async function until(f: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

interface Relay {
  url: string;
  tokens: DeviceTokens;
  stop: () => void;
}

async function relayOn(dataRoot: string, port = 0): Promise<Relay> {
  const server: Server = createServer();
  const tokens = new DeviceTokens(Buffer.from("test-key"), (slug) =>
    join(dataRoot, slug),
  );
  const stop = attachSyncRelay(server, {
    accountDir: (slug) => join(dataRoot, slug),
    accountOf: async (s) => (SECRETS.has(s) ? "acct" : null),
    deviceOf: (t) => tokens.verify(t)?.slug ?? null,
    log: () => {},
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}${SYNC_PATH}`;
  return {
    url,
    tokens,
    stop: () => {
      stop();
      server.close();
      server.closeAllConnections();
    },
  };
}

/** A workspace folder and its sync state, wired as liveSync.ts wires them; `start` again after `stop` is a restart. */
function device(url: string, auth: RelayAuth, files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "relay-dev-"));
  const logDir = mkdtempSync(join(tmpdir(), "relay-log-"));
  for (const [rel, text] of Object.entries(files)) put(root, rel, text);
  const d = {
    root,
    logDir,
    replica: null as unknown as Replica,
    link: null as unknown as RelayLink,
    stop: () => {},
    start: () => {
      const link = new RelayLink(url, auth, () => {});
      const capture = new LiveCapture({
        root,
        replica: JSON.stringify(auth),
        skip,
        isBinary,
        onBatch: (b) => link.local("band", b),
        quietMs: 30,
        reconcileMs: 0,
      });
      const written: string[] = [];
      const confirmed = new ConfirmedDir(join(logDir, "confirmed"));
      const replica = new Replica(
        JSON.stringify(auth),
        {
          read: (f) => capture.read(f),
          write: (f, t) => {
            written.push(f);
            capture.writeKnown(f, t);
          },
        },
        confirmed,
        loadHead(logDir),
      );
      link.add(
        { name: "band", capture, replica, written, onRemote: () => {} },
        logDir,
      );
      capture.start(replica.head > 0 ? confirmed : undefined);
      d.replica = replica;
      d.link = link;
      d.stop = () => {
        link.close();
        capture.stop();
      };
    },
  };
  d.start();
  cleanup.push(() => d.stop());
  return d;
}

async function refused(
  url: string,
  headers: Record<string, string>,
): Promise<number> {
  const ws = new WebSocket(url, { headers });
  return new Promise<number>((r) =>
    ws.on("unexpected-response", (_q, res) => r(res.statusCode ?? 0)),
  );
}

describe("the sync relay", () => {
  it("refuses an unknown secret, a forged token and a removed device's token", async () => {
    const relay = await relayOn(mkdtempSync(join(tmpdir(), "relay-data-")));
    cleanup.push(relay.stop);
    expect(await refused(relay.url, { "x-studio-hub-secret": "nope" })).toBe(
      401,
    );
    const { device: dev, token } = relay.tokens.mint("acct", "laptop");
    expect(
      await refused(relay.url, { authorization: `Bearer ${token}x` }),
    ).toBe(401);
    relay.tokens.revoke("acct", dev.id);
    expect(await refused(relay.url, { authorization: `Bearer ${token}` })).toBe(
      401,
    );
  });

  it("is seeded by its first replica, brings a newcomer current, relays both ways and survives a restart", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "relay-data-"));
    let relay = await relayOn(dataRoot);
    cleanup.push(() => relay.stop());
    const a = device(relay.url, { secret: "secret-a" }, { [FILE]: MIX });
    await until(() => a.replica.head === 1);
    const b = device(relay.url, { secret: "secret-b" }, {});
    await until(() => read(b.root, FILE) === MIX);

    const t0 = Date.now();
    put(a.root, FILE, MIX.replace("gain: 0.5", "gain: 0.9"));
    await until(() => read(b.root, FILE)?.includes("gain: 0.9") ?? false);
    const latency = Date.now() - t0;
    put(
      b.root,
      FILE,
      (read(b.root, FILE) ?? "").replace("pan: 0", "pan: -0.25"),
    );
    await until(() => read(a.root, FILE)?.includes("pan: -0.25") ?? false);

    const port = Number(new URL(relay.url).port);
    relay.stop();
    relay = await relayOn(dataRoot, port);
    put(
      a.root,
      FILE,
      (read(a.root, FILE) ?? "").replace("gain: 0.9", "gain: 0.3"),
    );
    await until(
      () => read(b.root, FILE)?.includes("gain: 0.3") ?? false,
      10_000,
    );
    expect(read(a.root, FILE)).toBe(read(b.root, FILE));
    expect(latency).toBeLessThan(1000);
  }, 30_000);

  it("lets a machine with work of its own join: its new files are sent, the room's version of the rest wins, its own kept aside", async () => {
    const relay = await relayOn(mkdtempSync(join(tmpdir(), "relay-data-")));
    cleanup.push(relay.stop);
    const server = device(relay.url, { secret: "secret-a" }, { [FILE]: MIX });
    await until(() => server.replica.head === 1);
    const mine = MIX.replace("pan: 0", "pan: 1");
    const { token } = relay.tokens.mint("acct", "laptop");
    const laptop = device(
      relay.url,
      { token },
      { [FILE]: mine, "song.st0/notes.md": "- mine\n" },
    );

    await until(() => read(server.root, "song.st0/notes.md") === "- mine\n");
    await until(() => read(laptop.root, FILE) === MIX);
    const displaced = join(laptop.logDir, "displaced");
    expect(existsSync(displaced)).toBe(true);
    const [stamp] = readdirSync(displaced);
    expect(
      readFileSync(join(displaced, stamp, ...FILE.split("/")), "utf8"),
    ).toBe(mine);
  });

  it("sends an edit made while a machine was off, and brings it what it missed", async () => {
    const relay = await relayOn(mkdtempSync(join(tmpdir(), "relay-data-")));
    cleanup.push(relay.stop);
    const server = device(relay.url, { secret: "secret-a" }, { [FILE]: MIX });
    await until(() => server.replica.head === 1);
    const { token } = relay.tokens.mint("acct", "laptop");
    const laptop = device(relay.url, { token }, {});
    await until(() => read(laptop.root, FILE) === MIX);

    laptop.stop();
    put(laptop.root, FILE, MIX.replace("pan: 0", "pan: 1"));
    put(server.root, FILE, MIX.replace("gain: 0.5", "gain: 0.8"));
    await until(() => server.replica.head === 2);
    laptop.start();

    for (const d of [server, laptop])
      await until(() => {
        const t = read(d.root, FILE) ?? "";
        return t.includes("pan: 1") && t.includes("gain: 0.8");
      });
    expect(read(laptop.root, FILE)).toBe(read(server.root, FILE));
  });

  it("sets aside an offline edit to a value that moved meanwhile, shows it everywhere, and takes it back on request", async () => {
    const relay = await relayOn(mkdtempSync(join(tmpdir(), "relay-data-")));
    cleanup.push(relay.stop);
    const server = device(relay.url, { secret: "secret-a" }, { [FILE]: MIX });
    await until(() => server.replica.head === 1);
    const { token } = relay.tokens.mint("acct", "phone");
    const phone = device(relay.url, { token }, {});
    await until(() => read(phone.root, FILE) === MIX);

    phone.stop();
    put(phone.root, FILE, MIX.replace("gain: 0.5", "gain: 0.1"));
    put(server.root, FILE, MIX.replace("gain: 0.5", "gain: 0.8"));
    await until(() => server.replica.head === 2);
    phone.start();

    for (const d of [server, phone])
      await until(() => d.replica.conflicts.list().length === 1);
    const [c] = server.replica.conflicts.list();
    expect(c.kept).toBe("0.8\n");
    expect(c.op).toMatchObject({ kind: "yaml", ops: [{ yaml: "0.1\n" }] });
    for (const d of [server, phone])
      await until(() => read(d.root, FILE)?.includes("gain: 0.8") ?? false);

    expect(phone.link.resolve("band", c.id, true)?.resolves).toEqual([c.id]);
    for (const d of [server, phone])
      await until(
        () =>
          d.replica.conflicts.list().length === 0 &&
          (read(d.root, FILE)?.includes("gain: 0.1") ?? false),
      );
    expect(read(phone.root, FILE)).toBe(read(server.root, FILE));
  });
});
