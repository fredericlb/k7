// Tests for the session id. Its whole job is that two processes spell it the same way, so
// what is pinned here is the SPELLING — a mismatch is silent on both sides.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION,
  forSession,
  SESSIONS,
  sessionFor,
} from "./sessions.ts";

describe("sessionFor", () => {
  it("is stable for one person and one service", () => {
    expect(sessionFor(SESSIONS.pistes, "fred@parapluie.org")).toBe(
      "pistes:fred_parapluie_org",
    );
  });

  // The collision this exists to end: two people on the SAME engine must not share a project.
  it("separates two people on one service", () => {
    expect(sessionFor("pistes", "a@x.org")).not.toBe(
      sessionFor("pistes", "b@x.org"),
    );
  });

  it("separates one person's services", () => {
    expect(sessionFor("pistes", "a@x.org")).not.toBe(
      sessionFor("mediatek", "a@x.org"),
    );
  });

  // A surface with no user — a deck on the machine in front of you — is unchanged.
  it("gives back the bare service with no user", () => {
    for (const who of [undefined, null, ""])
      expect(sessionFor("platines", who)).toBe("platines");
  });
});

describe("forSession", () => {
  it("reads a frame addressed to it", () => {
    expect(forSession({ session: "pistes:a" }, "pistes:a")).toBe(true);
  });

  it("drops another session's frame", () => {
    expect(forSession({ session: "pistes:b" }, "pistes:a")).toBe(false);
  });

  // DISAGREEMENT, not absence: engine-global replies carry no session, and an engine older
  // than sessions stamps nothing — requiring the field would make a new client deaf.
  it("lets an unstamped frame through", () => {
    expect(forSession({}, "pistes:a")).toBe(true);
    expect(forSession({ session: undefined }, DEFAULT_SESSION)).toBe(true);
  });
});
