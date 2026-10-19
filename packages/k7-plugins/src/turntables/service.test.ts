import { configureFileApi } from "@studio/project-shell/fileApi";
import {
  ENGINE_TOKEN_HEADER,
  USER_HEADER,
  WORKSPACE_HEADER,
} from "@studio/web-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileLink, service } from "./service";

// The file service gates EVERY route on the engine token, so this is what stops a second dialect.

const HEADERS = [USER_HEADER, WORKSPACE_HEADER, ENGINE_TOKEN_HEADER];

let sent: HeadersInit | undefined;

beforeEach(() => {
  configureFileApi({
    base: "http://engine.test:8770",
    userEmail: "dj@studio.test",
    workspace: "lemo_mante",
    engineToken: "tok",
    engineId: "e1",
  });
  sent = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      sent = init?.headers;
      return {
        ok: true,
        json: async () => ({ present: true, root: "/r", counts: {} }),
        text: async () => "plugin: { type: jsdsp }",
      } as unknown as Response;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const link = { base: "http://engine.test:8770" };

describe("every call to the machine's file service", () => {
  it("carries all three headers, not just the identity", async () => {
    await service.summary(link);
    for (const h of HEADERS) expect(sent).toHaveProperty(h);
    expect((sent as Record<string, string>)[ENGINE_TOKEN_HEADER]).toBe("tok");
  });

  it("carries them on the module read too, which answers TEXT", async () => {
    // A different code path, since the reply is TEXT and not JSON — so the one that drifts.
    await service.moduleFile(link, "/modules/audio/x/module.k7x");
    for (const h of HEADERS) expect(sent).toHaveProperty(h);
  });

  it("is addressed at the engine's own host, or not made at all", () => {
    // The base comes from the probe, never a text box — null is "nothing to call", not a doomed call.
    expect(fileLink({ fileBase: "http://engine.test:8770" })).toEqual(link);
    expect(fileLink({ fileBase: null })).toBe(null);
  });
});
