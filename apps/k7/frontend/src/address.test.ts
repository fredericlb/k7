import { describe, expect, it } from "vitest";
import { isAppAddress, scopeOf } from "./address";

const B = "/";
const ORIGIN = "https://app.k7.rocks";
const url = (p: string) => new URL(p, ORIGIN);

describe("scopeOf", () => {
  it("reads the root and the pages hanging off it as ONE home scope", () => {
    for (const p of ["/", "/libraries", "/settings", "/media/songs", "/tasks"])
      expect(scopeOf(p, B)).toMatchObject({ kind: "home", key: "home" });
  });

  it("keys a project by its basename, so its own routes stay in one scope", () => {
    const a = scopeOf("/@local/songs/first.k7", B);
    const b = scopeOf("/@local/songs/first.k7/timeline", B);
    expect(a).toMatchObject({
      kind: "project",
      basename: "/@local/songs/first.k7",
    });
    expect(b.key).toBe(a.key);
    expect(scopeOf("/@local/songs/second.k7", B).key).not.toBe(a.key);
  });

  it("reads the surfaces menu before a project, the word being a legal workspace", () => {
    expect(scopeOf("/external", B).kind).toBe("external-index");
  });

  it("names the surface a project tab draws", () => {
    const s = scopeOf("/@local/songs/first.k7/@external/desk", B);
    expect(s).toMatchObject({ kind: "project", external: "desk" });
  });

  it("tells a share from a project, and a rehearsal public page from the home", () => {
    const token = "A".repeat(22);
    expect(scopeOf(`/@shares/${token}.k7`, B)).toMatchObject({
      kind: "share",
      token,
    });
    expect(scopeOf("/rehearsal/@flb", B)).toMatchObject({
      kind: "rehearsal-public",
      nametag: "flb",
    });
    expect(scopeOf("/rehearsal/sessions", B).kind).toBe("home");
  });
});

describe("isAppAddress", () => {
  it("takes the home, a project and the surfaces menu", () => {
    for (const p of ["/", "/libraries", "/@local/songs/first.k7", "/external"])
      expect(isAppAddress(url(p), ORIGIN, B)).toBe(true);
  });

  it("leaves the server's routes, its files and other origins to the browser", () => {
    for (const p of [
      "/auth/logout",
      "/api/files/x",
      "/assets/index.js",
      "/favicon.svg",
      "/manifest.webmanifest",
    ])
      expect(isAppAddress(url(p), ORIGIN, B)).toBe(false);
    expect(isAppAddress(new URL("https://docs.k7.rocks/"), ORIGIN, B)).toBe(
      false,
    );
  });
});
