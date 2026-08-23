import { describe, expect, it } from "vitest";
import { isPublicPath } from "./middleware.ts";

// The public-path table, pinned: adding a route here is adding one nobody has to sign in for.
describe("isPublicPath", () => {
  it.each([
    ["/hello", true],
    ["/auth", true],
    ["/auth/login", true],
    ["/auth/guest-online", true],
    ["/audio/session/cat/song.mp3", true],
    ["/sessions/by-token/abc123", true],
    ["/game", false],
    ["/players", false],
    ["/solo/sessions", false],
    ["/editor/sessions", false],
    ["/ws", false],
    ["/ws/buzzer", false],
    ["/sessions", false],
    ["/sessions/select", false],
  ])("%s -> %s", (path, expected) => {
    expect(isPublicPath(path)).toBe(expected);
  });
});
