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
  it("plays the bench in its own session, and a song in st0's", () => {
    expect(engineSession("a@x.org", "/@banc/vocals/warm/live.st0", "/")).toBe(
      sessionFor(SESSIONS.bench, "a@x.org"),
    );
    expect(engineSession("a@x.org", "/@local/ws/song.st0/graph", "/")).toBe(
      sessionFor(SESSIONS.st0, "a@x.org"),
    );
    expect(engineSession("a@x.org", "/", "/")).toBe(
      sessionFor(SESSIONS.st0, "a@x.org"),
    );
  });
});

describe("accountEngine", () => {
  it("is the reachable engine this account plays a SONG on — not a bench, not someone else's", () => {
    const ranked = [
      row("theirs", [{ holder: "b@x.org", project: "@local/w/s.st0" }]),
      row("bench", [{ holder: "a@x.org", project: "@banc/live.st0" }]),
      row("gone", [{ holder: "a@x.org", project: "@local/w/s.st0" }], null),
      row("mine", [{ holder: "a@x.org", project: "@local/w/s.st0" }]),
    ];
    expect(accountEngine(ranked, "a@x.org")?.engine.id).toBe("mine");
    expect(accountEngine(ranked.slice(0, 3), "a@x.org")).toBeUndefined();
  });
});
