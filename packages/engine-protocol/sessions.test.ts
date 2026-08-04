// Tests for the session id. Its whole job is that two processes spell it the same way, so
// what is pinned here is the SPELLING — a mismatch is silent on both sides.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION,
  ENGINE_GLOBAL_REPLIES,
  forSession,
  PER_SESSION_REPLIES,
  SESSIONS,
  sessionFor,
} from "./sessions.ts";

describe("sessionFor", () => {
  it("is stable for one person and one service", () => {
    expect(sessionFor(SESSIONS.l8, "fred@parapluie.org")).toBe(
      "l8:fred_parapluie_org",
    );
  });

  // The collision this exists to end: two people on the SAME engine must not share a project.
  it("separates two people on one service", () => {
    expect(sessionFor("l8", "a@x.org")).not.toBe(sessionFor("l8", "b@x.org"));
  });

  it("separates one person's services", () => {
    expect(sessionFor("l8", "a@x.org")).not.toBe(sessionFor("st0", "a@x.org"));
  });

  // A surface with no user — a deck on the machine in front of you — is unchanged.
  it("gives back the bare service with no user", () => {
    for (const who of [undefined, null, ""])
      expect(sessionFor("m9", who)).toBe("m9");
  });
});

describe("forSession", () => {
  it("reads a frame addressed to it", () => {
    expect(forSession({ session: "l8:a" }, "l8:a")).toBe(true);
  });

  it("drops another session's frame", () => {
    expect(forSession({ session: "l8:b" }, "l8:a")).toBe(false);
  });

  // DISAGREEMENT, not absence: engine-global replies carry no session, and an engine older
  // than sessions stamps nothing — requiring the field would make a new client deaf.
  it("lets an unstamped frame through", () => {
    expect(forSession({}, "l8:a")).toBe(true);
    expect(forSession({ session: undefined }, DEFAULT_SESSION)).toBe(true);
  });

  // An old client sends no session, so the engine stamps its replies "" — and "" is what that
  // client drives. The two must still agree, or sessions would break every client that predates them.
  it("keeps the default session's own frames", () => {
    expect(forSession({ session: "" }, DEFAULT_SESSION)).toBe(true);
  });
});

// The two tables ARE the contract: "unstamped" is a closed set, not a tendency, and this is the
// one place both clients read it. A reply that moves between them has to move here first.
describe("the stamped/unstamped sets", () => {
  it("does not put a reply in both", () => {
    const global = new Set<string>(ENGINE_GLOBAL_REPLIES);
    for (const type of PER_SESSION_REPLIES)
      expect(global.has(type)).toBe(false);
  });

  it("drops every per-session reply that belongs to someone else", () => {
    for (const type of PER_SESSION_REPLIES)
      expect(forSession({ type, session: "l8:b" }, "l8:a")).toBe(false);
  });

  it("keeps every per-session reply of its own", () => {
    for (const type of PER_SESSION_REPLIES)
      expect(forSession({ type, session: "l8:a" }, "l8:a")).toBe(true);
  });

  it("lets every engine-global reply through unstamped", () => {
    for (const type of ENGINE_GLOBAL_REPLIES)
      expect(forSession({ type }, "l8:a")).toBe(true);
  });
});
