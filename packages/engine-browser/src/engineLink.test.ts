// The link's lifecycle on a fake socket and a fake clock: the backoff ladder, the generation that
// keeps a late event from starting a second ladder, the watchdog on a deaf socket, and the outbox
// that covers a blink and nothing more. See docs/reliability.md.

import {
  ENGINE_CONNECT_DEADLINE_MS,
  ENGINE_IDLE_PING_MS,
  ENGINE_OUTBOX_TTL_MS,
  ENGINE_PONG_TIMEOUT_MS,
} from "@studio/web-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EngineLink } from "./engineLink";

/** A WebSocket that does nothing until the test says so. */
class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static all: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  binaryType = "blob";
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  drop() {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
  hear(m: object) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  types(): string[] {
    return this.sent.map((s) => JSON.parse(s).type);
  }
}

class TestLink extends EngineLink {
  heard: { type?: string }[] = [];
  protected dispatch(m: { type?: string }): void {
    this.heard.push(m);
  }
  push(o: object): void {
    this.send(o);
  }
}

const sockets = () => FakeSocket.all;
const last = () => FakeSocket.all[FakeSocket.all.length - 1];

/** Let the URL lookup's promise settle, which is what stands between `connect()` and the dial. */
const dialed = () => vi.advanceTimersByTimeAsync(0);

let link: TestLink;
let conn: boolean[];

beforeEach(async () => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  // No jitter: each wait is the full step of the ladder.
  vi.spyOn(Math, "random").mockReturnValue(1);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  link = new TestLink("ws://engine.test");
  conn = [];
  link.onConnected((c) => conn.push(c));
  link.connect();
  await dialed();
});

afterEach(() => {
  link.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the reconnect ladder", () => {
  it("says hello first on every open, and tells the host", () => {
    last().open();
    expect(last().types()).toEqual(["hello"]);
    expect(conn).toEqual([true]);
  });

  it("doubles its wait after each failure, and starts over on a socket that opened", async () => {
    sockets()[0].drop();
    expect(conn).toEqual([false]);
    await vi.advanceTimersByTimeAsync(999);
    expect(sockets()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets()).toHaveLength(2);
    last().drop();
    await vi.advanceTimersByTimeAsync(1999);
    expect(sockets()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets()).toHaveLength(3);
    last().open();
    last().drop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets()).toHaveLength(4);
  });

  it("gives up on a dial that neither opens nor closes, and tries again", async () => {
    await vi.advanceTimersByTimeAsync(ENGINE_CONNECT_DEADLINE_MS);
    expect(conn).toEqual([false]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets()).toHaveLength(2);
  });

  it("runs ONE ladder when the watchdog and the close both report the same socket", async () => {
    last().open();
    // Deaf: nothing arrives, so the watchdog asks, waits, and drops the socket itself.
    await vi.advanceTimersByTimeAsync(
      ENGINE_IDLE_PING_MS + ENGINE_PONG_TIMEOUT_MS,
    );
    expect(last().types()).toContain("whoami");
    // The watchdog ticks every PONG_TIMEOUT, so the answer is overdue on the second tick after the ask.
    await vi.advanceTimersByTimeAsync(2 * ENGINE_PONG_TIMEOUT_MS);
    expect(conn).toEqual([true, false]);
    // …and the close it provoked arrives late: no second notice, no second ladder.
    sockets()[0].onclose?.();
    expect(conn).toEqual([true, false]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets()).toHaveLength(2);
    // A second ladder would have dialled again by now, its own first step being the doubled one.
    await vi.advanceTimersByTimeAsync(2000);
    expect(sockets()).toHaveLength(2);
  });

  it("keeps a talking socket without a single ping", async () => {
    last().open();
    for (let t = 0; t < 4 * ENGINE_IDLE_PING_MS; t += 1000) {
      last().hear({ type: "state" });
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(last().types()).not.toContain("whoami");
    expect(conn).toEqual([true]);
  });

  it("stops for good on dispose, whatever was pending", async () => {
    last().drop();
    link.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets()).toHaveLength(1);
  });
});

describe("the outbox", () => {
  it("holds what was sent while down and replays it after hello, oldest first", () => {
    link.push({ type: "transport", action: "play" });
    link.push({ type: "flush" });
    last().open();
    expect(last().types()).toEqual(["hello", "transport", "flush"]);
  });

  it("drops what waited past its age instead of replaying it late", async () => {
    link.push({ type: "transport", action: "play" });
    await vi.advanceTimersByTimeAsync(ENGINE_OUTBOX_TTL_MS);
    last().open();
    expect(last().types()).toEqual(["hello"]);
  });

  it("sends at once on an open socket, and ignores frames from a socket it left", async () => {
    const first = last();
    first.open();
    link.push({ type: "flush" });
    expect(first.types()).toEqual(["hello", "flush"]);
    first.drop();
    await vi.advanceTimersByTimeAsync(1000);
    first.hear({ type: "late" });
    expect(link.heard).toEqual([]);
  });
});
