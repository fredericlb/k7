// syncFeed.test.ts — the page's one change stream: shared by every consumer, closed with the last,
// and given up for good on an answer that is not a stream, so nothing reconnects in a loop.

import { describe, expect, it } from "vitest";
import {
  createSyncFeed,
  type EventSourceLike,
  type SyncNotice,
} from "./syncFeed";

class FakeSource implements EventSourceLike {
  readyState = 0;
  closed = false;
  private fns = new Map<string, ((e: MessageEvent) => void)[]>();
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.fns.set(type, [...(this.fns.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  fire(type: string, data?: unknown) {
    for (const fn of this.fns.get(type) ?? [])
      fn({ data: JSON.stringify(data) } as MessageEvent);
  }
}

const notice: SyncNotice = {
  workspace: "band",
  seq: 3,
  files: ["a.k7x"],
  parked: 0,
  settled: 0,
};

describe("createSyncFeed", () => {
  it("opens one source for every consumer and closes it with the last", () => {
    const opened: FakeSource[] = [];
    const feed = createSyncFeed(() => {
      const s = new FakeSource();
      opened.push(s);
      return s;
    });
    const got: number[] = [];
    const offA = feed.subscribe({ notice: (n) => got.push(n.seq) });
    const offB = feed.subscribe({ notice: (n) => got.push(n.seq * 10) });
    expect(opened).toHaveLength(1);
    opened[0].fire("ordered", notice);
    expect(got).toEqual([3, 30]);
    offA();
    expect(opened[0].closed).toBe(false);
    offB();
    expect(opened[0].closed).toBe(true);
  });

  it("tells consumers when it is live, a late one included", () => {
    const opened: FakeSource[] = [];
    const feed = createSyncFeed(() => {
      const s = new FakeSource();
      opened.push(s);
      return s;
    });
    const a: boolean[] = [];
    feed.subscribe({ notice: () => {}, live: (v) => a.push(v) });
    opened[0].fire("open");
    const b: boolean[] = [];
    feed.subscribe({ notice: () => {}, live: (v) => b.push(v) });
    expect(a).toEqual([true]);
    expect(b).toEqual([true]);
    opened[0].fire("error");
    expect(a).toEqual([true, false]);
  });

  it("gives up for good on an answer that was not a stream", () => {
    let opens = 0;
    let last: FakeSource | null = null;
    const feed = createSyncFeed(() => {
      opens++;
      last = new FakeSource();
      return last;
    });
    const off = feed.subscribe({ notice: () => {} });
    const s = last as unknown as FakeSource;
    s.readyState = 2; // a 401: the browser closed it
    s.fire("error");
    expect(s.closed).toBe(true);
    off();
    feed.subscribe({ notice: () => {} });
    expect(opens).toBe(1);
  });

  it("opens nothing where there is nothing to open, and asks again for the next first consumer", () => {
    let can = false;
    let opens = 0;
    const feed = createSyncFeed(() => {
      if (!can) return null;
      opens++;
      return new FakeSource();
    });
    feed.subscribe({ notice: () => {} })();
    can = true;
    feed.subscribe({ notice: () => {} });
    expect(opens).toBe(1);
  });
});
