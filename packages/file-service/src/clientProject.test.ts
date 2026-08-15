// ONE writer for one engine. The turntables surface builds a document — this project's compile
// with the decks' clips in it — and hands it here instead of pushing it on its own socket, so
// the service and the surface cannot overwrite each other. What is pinned is the ordering rule,
// which is the whole of the fix: see packages/song/docs/surfaces.md.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc } from "@studio/engine-protocol/build";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** A stand-in engine that records the documents it is sent, which is all this test reads. */
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
  connect() {}
  close() {}
  flush() {}
  dropSession() {}
  setAudioDevice() {}
  transport() {}
  sendProject(doc: ProjectDoc) {
    this.sent.push(doc);
  }
}
vi.mock("@studio/engine-client/engineClient", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  EngineClient: FakeClient,
}));

const {
  applyClientProject,
  reloadActiveProject,
  setSelectedEngine,
  startEngineForActive,
} = await import("./engineLink.ts");

let root: string;
/** Enough of a Workspace for the engine link: where the project is, and what it compiles to. */
const wsWith = (dir: string, name: string) => ({
  root,
  activeProjectPath: () => dir,
  cachedProjectDoc: () => emptyDoc({ name }),
  invalidateProjectDoc: () => {},
});

/**
 * What was sent SINCE this test started.
 *
 * The link is cached per session and every case here lands on the same one (a temp dir outside
 * the users root falls back to the bare service id), so there is one client for the whole file
 * and clearing `built` between tests would just hide it. A baseline says the same thing without
 * pretending each test gets a fresh engine — which is also truer to the service, where it does
 * not either.
 */
let baseline = 0;
const names = () => (built[0]?.sent ?? []).slice(baseline).map((d) => d.name);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-clientdoc-"));
  setSelectedEngine("ws://127.0.0.1:1/");
  baseline = built[0]?.sent.length ?? 0;
});

describe("a document the browser built", () => {
  it("reaches the engine through the service's own link", () => {
    // The point of the route: there is one socket, and it is this one.
    // biome-ignore lint/suspicious/noExplicitAny: a Workspace stand-in, see wsWith
    const ws = wsWith(root, "compiled") as any;
    startEngineForActive(ws);
    applyClientProject(ws, emptyDoc({ name: "with-decks" }));
    expect(names()).toEqual(["compiled", "with-decks"]);
  });

  it("is NOT overwritten when the project is re-served from disk", () => {
    // The bug this fixes. The service pushing the bare compile under a running set would drop
    // the decks' clips, and the surface would blink empty until its next gesture. The browser
    // polls `/revision`, rebuilds from the fresh compile and hands its own back instead.
    // biome-ignore lint/suspicious/noExplicitAny: a Workspace stand-in, see wsWith
    const ws = wsWith(root, "compiled") as any;
    startEngineForActive(ws);
    applyClientProject(ws, emptyDoc({ name: "with-decks" }));
    startEngineForActive(ws); // e.g. another /open on the same project
    expect(names()).toEqual(["compiled", "with-decks"]);
  });

  it("is dropped by an explicit reload, which is what that command is FOR", () => {
    // Somebody asked for what is on disk. Answering "no, a surface has the engine" would refuse
    // the one command that exists to force exactly this.
    // biome-ignore lint/suspicious/noExplicitAny: a Workspace stand-in, see wsWith
    const ws = wsWith(root, "compiled") as any;
    startEngineForActive(ws);
    applyClientProject(ws, emptyDoc({ name: "with-decks" }));
    reloadActiveProject(ws);
    expect(names()).toEqual(["compiled", "with-decks", "compiled"]);
  });

  it("does not survive into a DIFFERENT project", () => {
    // A document built for the project being left names its tracks and its clips; serving it
    // over the next project would play the previous set.
    const other = mkdtempSync(join(tmpdir(), "td-clientdoc-b-"));
    try {
      // biome-ignore lint/suspicious/noExplicitAny: a Workspace stand-in, see wsWith
      const ws = wsWith(root, "first") as any;
      startEngineForActive(ws);
      applyClientProject(ws, emptyDoc({ name: "with-decks" }));
      // biome-ignore lint/suspicious/noExplicitAny: a Workspace stand-in, see wsWith
      startEngineForActive(wsWith(other, "second") as any);
      expect(names()).toEqual(["first", "with-decks", "second"]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
