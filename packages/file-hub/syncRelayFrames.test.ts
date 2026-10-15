// syncRelayFrames.test.ts — what a hostile replica sends the relay: frames it must answer with an error, not die on.

import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { type AddressInfo, connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { ENTRIES } from "./historyLog.ts";
import { attachSyncRelay, SYNC_PATH } from "./syncRelay.ts";

let server: Server | null = null;
let stop: (() => void) | null = null;

afterEach(() => {
  stop?.();
  server?.close();
  server?.closeAllConnections();
});

async function relay(dataRoot: string) {
  server = createServer();
  stop = attachSyncRelay(server, {
    accountDir: (slug) => join(dataRoot, slug),
    accountOf: async (s) => (s === "secret" ? "acct" : null),
    log: () => {},
  });
  await new Promise<void>((r) => server?.listen(0, "127.0.0.1", () => r()));
  return (server.address() as AddressInfo).port;
}

/** A socket and the frames it receives, answered in order. */
async function replica(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${SYNC_PATH}`, {
    headers: { "x-studio-hub-secret": "secret" },
  });
  const got: Record<string, unknown>[] = [];
  ws.on("message", (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on("open", r));
  const ask = async (frame: unknown) => {
    const n = got.length;
    ws.send(typeof frame === "string" ? frame : JSON.stringify(frame));
    const end = Date.now() + 3000;
    while (got.length === n && Date.now() < end)
      await new Promise((r) => setTimeout(r, 5));
    return got[n];
  };
  return { ws, ask };
}

const batch = (ops: unknown[]) => ({
  id: "b1",
  replica: "r",
  local: 1,
  ts: 0,
  label: "edit",
  ops,
});

describe("the relay, against a hostile replica", () => {
  it("answers malformed frames with an error and stays up", async () => {
    const port = await relay(mkdtempSync(join(tmpdir(), "relay-frames-")));
    const { ws, ask } = await replica(port);
    expect((await ask({ t: "hello", workspace: "w", since: 0 }))?.t).toBe(
      "welcome",
    );
    for (const ops of [[null], [1], [{ kind: "text", text: "x" }]])
      expect(
        await ask({ t: "batch", workspace: "w", batch: batch(ops) }),
      ).toMatchObject({ t: "error" });
    expect(await ask("not json")).toMatchObject({ t: "error" });
    expect(await ask(null)).toMatchObject({ t: "error" });
    const fine = batch([{ kind: "text", file: "a.md", text: "x" }]);
    expect(
      await ask({ t: "batch", workspace: "w", batch: fine }),
    ).toMatchObject({ t: "seq" });
    ws.close();
  });

  it("refuses a path or a room name that climbs out, and writes nothing there", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "relay-frames-"));
    const port = await relay(dataRoot);
    const { ws, ask } = await replica(port);
    for (const workspace of ["..", ".", "a/b", "@lib/k7-core"])
      expect(await ask({ t: "hello", workspace, since: 0 })).toMatchObject({
        t: "error",
      });
    await ask({ t: "hello", workspace: "w", since: 0 });
    const climb = batch([{ kind: "text", file: "../../x", text: "x" }]);
    expect(
      await ask({ t: "batch", workspace: "w", batch: climb }),
    ).toMatchObject({ t: "error" });
    expect(readdirSync(join(dataRoot, "acct", ".sync-relay"))).toEqual(["w"]);
    expect(readdirSync(dataRoot)).toEqual(["acct"]);
    const entries = join(dataRoot, "acct", ".sync-relay", "w", ENTRIES);
    expect(existsSync(entries) ? readFileSync(entries, "utf8") : "").toBe("");
    ws.close();
  });

  it("lets an upgrade whose address does not parse go by, rather than throw", async () => {
    const port = await relay(mkdtempSync(join(tmpdir(), "relay-frames-")));
    const reply = await new Promise<string>((r) => {
      const s = connect(port, "127.0.0.1", () =>
        s.write(
          "GET // HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
        ),
      );
      s.on("close", () => r("closed"));
      s.on("error", () => r("closed"));
    });
    expect(reply).toBe("closed");
    const { ws, ask } = await replica(port);
    expect((await ask({ t: "hello", workspace: "w", since: 0 }))?.t).toBe(
      "welcome",
    );
    ws.close();
  });
});
