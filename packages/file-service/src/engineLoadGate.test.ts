// The gate's one promise: `engineLoadOf` is null only once the session's project is ON the engine
// the service drives. A project opened while no engine is bound is on none, whatever the page's own
// socket says — answered null, a Play pressed then beat the project there. See docs/engineLoad.md.

import { join } from "node:path";
import { emptyDoc } from "@studio/engine-protocol/build";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rootDir } from "./slug.ts";

/** A stand-in engine that takes documents and never answers `list-sessions`: the load stays in flight. */
const built: FakeClient[] = [];
class FakeClient {
  sent: ProjectDoc[] = [];
  constructor(
    readonly url: string,
    readonly session: string,
  ) {
    built.push(this);
  }
  on() {}
  off() {}
  connect() {}
  close() {}
  listSessions() {}
  sendProject(doc: ProjectDoc) {
    this.sent.push(doc);
  }
  flush() {}
  setRecordEnabled() {}
  dropSession() {}
  setAudioDevice() {}
  transport() {}
}
vi.mock("@studio/engine-client/engineClient", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  EngineClient: FakeClient,
}));

const {
  clearSelectedEngine,
  engineLoadOf,
  setSelectedEngine,
  startEngineForActive,
  unloadEngine,
} = await import("./engineLink.ts");

const root = join(rootDir(), "gate");
const ws = (project: string) =>
  ({
    root,
    activeProjectPath: () => join(root, project),
    cachedProjectDoc: () => emptyDoc({ name: project }),
    invalidateProjectDoc: () => {},
    // biome-ignore lint/suspicious/noExplicitAny: a Workspace stand-in — the link reads these four
  }) as any;

/** Every document the engines were sent, in order, by project name. */
const sentNames = () => built.flatMap((c) => c.sent.map((d) => d.name));

describe("engineLoadOf", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await unloadEngine(ws("none.k7"));
    built.length = 0;
  });

  it("holds Play while a project opened with no engine bound is on none", () => {
    // The previous song played, then the hub let go of the engine: its claim lapsed between two pages.
    setSelectedEngine("ws://127.0.0.1:5000/a");
    startEngineForActive(ws("old.k7"));
    clearSelectedEngine();
    startEngineForActive(ws("new.k7"));
    expect(sentNames()).not.toContain("new.k7");
    expect(engineLoadOf(ws("new.k7"))).not.toBeNull();
  });

  it("starts the load when the engine is bound again, even at the same address", () => {
    setSelectedEngine("ws://127.0.0.1:5000/b");
    startEngineForActive(ws("old.k7"));
    clearSelectedEngine();
    startEngineForActive(ws("new.k7"));
    expect(engineLoadOf(ws("new.k7"))).not.toBeNull();
    setSelectedEngine("ws://127.0.0.1:5000/b");
    expect(engineLoadOf(ws("new.k7"))).not.toBeNull();
    expect(sentNames()).toContain("new.k7");
  });

  it("starts the load on an engine bound at a new address", () => {
    setSelectedEngine("ws://127.0.0.1:5000/c");
    startEngineForActive(ws("old.k7"));
    clearSelectedEngine();
    startEngineForActive(ws("new.k7"));
    setSelectedEngine("ws://127.0.0.1:5000/d");
    expect(engineLoadOf(ws("new.k7"))).not.toBeNull();
    expect(sentNames()).toContain("new.k7");
  });

  it("waits for nothing when the session serves no project", () => {
    clearSelectedEngine();
    expect(engineLoadOf(ws("none.k7"))).toBeNull();
  });
});
