import { installServerPlugins } from "@studio/st0-sdk/install";
import { describe, expect, it } from "vitest";
import { BROWSER_PLUGINS, builtinBrowserPlugins } from "./browser";
import { BUILTIN_PLUGINS } from "./server";

// The composition lists are the whole point of this package — the file-service installs the
// first and the shell registers the second — so the tests pin that they EXIST and that the
// installer accepts them without a murmur (a duplicate in either list is an install-time error).

describe("the composition lists", () => {
  it("install into the server registries without a murmur", () => {
    expect(() => installServerPlugins(BUILTIN_PLUGINS)).not.toThrow();
  });

  it("are INDEPENDENT lists — a plugin may be server-only or browser-only", () => {
    // transcription is server-only (a verb); turntables is browser-only (a drawer). What both
    // sides share is the CONTRACT: every browser plugin carries at least one pane drawer.
    for (const p of BROWSER_PLUGINS)
      expect(p.panes?.length ?? 0, p.id).toBeGreaterThan(0);
    expect(builtinBrowserPlugins()).toEqual(BROWSER_PLUGINS);
  });
});
