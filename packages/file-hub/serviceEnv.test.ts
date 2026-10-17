// An account's file service runs that account's code paths: the backend's secrets must not reach it.

import { describe, expect, it } from "vitest";
import { serviceEnv } from "./serviceEnv.ts";

describe("the environment a file service starts with", () => {
  const parent = {
    PATH: "/usr/bin",
    HOME: "/home/node",
    LC_ALL: "C",
    STUDIO_MEDIATEK: "/library",
    STUDIO_DSP_EXEC: "/usr/local/libexec/dsp-exec",
    SESSION_SECRET: "s",
    OIDC_CLIENT_SECRET: "s",
    API_TOKEN_SECRET: "s",
    K7_API_TOKEN_SECRET: "s",
    STUDIO_RENDER_KEY: "s",
    STUDIO_ENGINE_TOKEN: "s",
    STUDIO_SYNC_TOKEN: "s",
    POCKETBASE_PASSWORD: "s",
    K7_TOKEN: "s",
    NODE_OPTIONS: "--require /tmp/x.js",
  };

  it("keeps what the service and its programs read", () => {
    expect(serviceEnv(parent)).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/node",
      LC_ALL: "C",
      STUDIO_MEDIATEK: "/library",
      STUDIO_DSP_EXEC: "/usr/local/libexec/dsp-exec",
    });
  });

  it("passes no secret, whatever its name", () => {
    const out = serviceEnv(parent);
    expect(Object.values(out)).not.toContain("s");
  });
});
