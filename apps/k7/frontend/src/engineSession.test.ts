// The browser half of the bench's session — the file service's `sessionOf` is the other, and
// packages/file-service/src/engineLink.test.ts pins it to the same SESSIONS.bench.

import { SESSIONS, sessionFor } from "@studio/engine-protocol/sessions";
import type { PublicEngine } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { accountEngine, engineSession } from "./engineSession";

const row = (
  id: string,
  heldProjects: { holder: string; project: string }[],
  wsUrl: string | null = "ws://x",
) => ({
  engine: {
    id,
    hostname: id,
    addresses: {} as PublicEngine["addresses"],
    assigned: true,
    sameSourceIp: false,
    heldProjects,
  } as PublicEngine,
  wsUrl,
});

describe("engineSession", () => {
  it("plays the bench in its own session, and a song in k7's", () => {
    expect(engineSession("a@x.org", "/@banc/vocals/warm/live.k7", "/")).toBe(
      sessionFor(SESSIONS.bench, "a@x.org"),
    );
    expect(engineSession("a@x.org", "/@local/ws/song.k7/graph", "/")).toBe(
      sessionFor(SESSIONS.k7, "a@x.org"),
    );
    expect(engineSession("a@x.org", "/", "/")).toBe(
      sessionFor(SESSIONS.k7, "a@x.org"),
    );
  });
});

describe("accountEngine", () => {
  it("is the reachable engine this account plays a SONG on — not a bench, not someone else's", () => {
    const ranked = [
      row("theirs", [{ holder: "b@x.org", project: "@local/w/s.k7" }]),
      row("bench", [{ holder: "a@x.org", project: "@banc/live.k7" }]),
      row("gone", [{ holder: "a@x.org", project: "@local/w/s.k7" }], null),
      row("mine", [{ holder: "a@x.org", project: "@local/w/s.k7" }]),
    ];
    expect(accountEngine(ranked, "a@x.org")?.engine.id).toBe("mine");
    expect(accountEngine(ranked.slice(0, 3), "a@x.org")).toBeUndefined();
  });
});
