// engineRestart.test.ts — a reconnect that meets ANOTHER engine process is a restart (a crash the
// supervisor recovered from), and only that: the first meeting, the same process again, and an
// engine too old to say which process it is all stay quiet.

import { describe, expect, it } from "vitest";
import { EngineClient } from "./engine";

function client(): { feed: (m: object) => void; restarts: () => number } {
  const c = new EngineClient("ws://never-opened");
  let n = 0;
  c.onEngineRestart(() => n++);
  const feed = (m: object) =>
    (c as unknown as { dispatch: (m: object) => void }).dispatch(m);
  return { feed, restarts: () => n };
}

describe("an engine restart", () => {
  it("is told when a whoami names another process", () => {
    const { feed, restarts } = client();
    feed({ type: "whoami", id: "e1", boot: "100" });
    feed({ type: "whoami", id: "e1", boot: "100" });
    expect(restarts()).toBe(0);
    feed({ type: "whoami", id: "e1", boot: "200" });
    expect(restarts()).toBe(1);
  });

  it("is never told by an engine that sends no boot", () => {
    const { feed, restarts } = client();
    feed({ type: "whoami", id: "e1" });
    feed({ type: "whoami", id: "e1" });
    expect(restarts()).toBe(0);
  });
});
