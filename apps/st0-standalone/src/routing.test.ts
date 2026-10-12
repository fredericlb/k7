import { describe, expect, it } from "vitest";
import { destination, projectKey } from "./routing.ts";

const O = "http://127.0.0.1:18789";

describe("destination", () => {
  it("sends another origin to the browser", () => {
    expect(destination("https://example.com/x", O)).toEqual({ to: "browser" });
  });

  it("keeps the sign-in round trip in place", () => {
    expect(destination(`${O}/auth/local?return_to=/`, O)).toEqual({
      to: "inPlace",
    });
    expect(destination(`${O}/api/me`, O)).toEqual({ to: "inPlace" });
  });

  it("sends a sign-in to the system browser", () => {
    expect(destination(`${O}/auth/login?return_to=/`, O)).toEqual({
      to: "signIn",
    });
  });

  it("sends the home page and its sub-pages home", () => {
    for (const p of [
      "/",
      "/libraries",
      "/settings",
      "/media/songs",
      "/external",
    ])
      expect(destination(`${O}${p}`, O)).toEqual({ to: "home" });
  });

  it("names a project by its key, whatever view follows", () => {
    const a = destination(`${O}/@local/ws/song.st0`, O);
    const b = destination(`${O}/@local/ws/song.st0/timeline?panel=mix`, O);
    expect(a).toEqual({ to: "project", key: "@local/ws/song.st0" });
    expect(b).toEqual(a);
  });

  it("opens a surface as a window", () => {
    expect(
      destination(`${O}/@local/ws/song.st0/@external/viewport`, O),
    ).toEqual({ to: "window" });
  });
});

describe("projectKey", () => {
  it("tells folder-less addresses apart by their second segment", () => {
    expect(projectKey("/@local/a")).toBe("@local/a");
    expect(projectKey("/@local/b")).toBe("@local/b");
    expect(projectKey("/@shares/tok")).toBe("@shares/tok");
  });

  it("keeps nested projects whole", () => {
    expect(projectKey("/@local/ws/sets/live.st0/chains")).toBe(
      "@local/ws/sets/live.st0",
    );
  });
});
