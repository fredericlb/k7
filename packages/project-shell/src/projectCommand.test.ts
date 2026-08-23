// What `projectApi.command` puts on the wire — the body, not the reply.
//
// `want` is the field that decides whether the file service spends ~62 ms building a graph
// nobody will draw, and the way it goes wrong is a call site that forgets it rather than a
// branch that misreads it. So this pins the three shapes: none (the old contract, which must
// stay the default), the empty list (a caller saying no), and a folder other than the song.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureFileApi } from "./fileApi.ts";
import { projectApi } from "./project.ts";

let bodies: unknown[] = [];

beforeEach(() => {
  bodies = [];
  configureFileApi({
    base: "http://x",
    userEmail: "a@b.c",
    workspace: "w",
    engineToken: "t",
    engineId: "e1",
  });
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ output: [] }),
    } as unknown as Response);
  });
});

describe("projectApi.command", () => {
  it("says nothing about `want` when the caller does not — the graph still comes back", async () => {
    await projectApi.command("track mute gtr");
    expect(bodies).toEqual([{ line: "track mute gtr" }]);
  });

  it("carries an EMPTY want, which is a caller refusing the graph", async () => {
    await projectApi.command("track mute gtr", { want: [] });
    // Not dropped as falsy: `[]` and "absent" are the two opposite answers here.
    expect(bodies).toEqual([{ line: "track mute gtr", want: [] }]);
  });

  it("carries `at` and `want` together — the chains builder's shape", async () => {
    await projectApi.command("node new amp", { at: "_library/x", want: [] });
    expect(bodies).toEqual([
      { line: "node new amp", at: "_library/x", want: [] },
    ]);
  });

  it("asks for the graph when the caller will draw it", async () => {
    await projectApi.command("event add gtr clip 1.1.1", { want: ["graph"] });
    expect(bodies).toEqual([
      { line: "event add gtr clip 1.1.1", want: ["graph"] },
    ]);
  });
});
