// What `projectApi.complete` hands back, whichever shape the file service answered in.
//
// The service and the shell ship in different images, so a shell may meet a service that
// predates labels: both shapes must come out as the same list of items.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureFileApi } from "./fileApi.ts";
import { projectApi } from "./project.ts";

let urls: string[] = [];
let reply: unknown = [];

beforeEach(() => {
  urls = [];
  configureFileApi({
    base: "http://x",
    userEmail: "a@b.c",
    workspace: "w",
    engineToken: "t",
    engineId: "e1",
  });
  vi.stubGlobal("fetch", (url: string) => {
    urls.push(url);
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(reply)),
    } as unknown as Response);
  });
});

describe("projectApi.complete", () => {
  it("asks for labels", async () => {
    reply = [];
    await projectApi.complete("node bypass ");
    expect(urls[0]).toContain("labels=1");
    expect(urls[0]).toContain(`line=${encodeURIComponent("node bypass ")}`);
  });

  it("turns a bare line into an item with no label", async () => {
    reply = ["track mute gtr", "track mute bass"];
    expect(await projectApi.complete("track mute ")).toEqual([
      { line: "track mute gtr" },
      { line: "track mute bass" },
    ]);
  });

  it("keeps a labelled candidate beside unlabelled ones", async () => {
    reply = [
      { line: "node bypass 0b7c", label: "@k7-core/auto-wah · fx · step 2" },
      "node bypass gtr",
    ];
    expect(await projectApi.complete("node bypass ")).toEqual([
      { line: "node bypass 0b7c", label: "@k7-core/auto-wah · fx · step 2" },
      { line: "node bypass gtr" },
    ]);
  });
});
