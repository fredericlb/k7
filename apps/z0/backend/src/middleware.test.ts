import { describe, expect, it } from "vitest";
import { isPublicPath } from "./middleware.ts";

// Mirrors auth.go's isPublicPath table — these must stay in lockstep with the
// Go server until the port is complete.
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
