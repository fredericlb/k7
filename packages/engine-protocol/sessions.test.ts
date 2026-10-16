// Tests for the session id. Its whole job is that two processes spell it the same way, so
// what is pinned here is the SPELLING — a mismatch is silent on both sides.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
    expect(sessionFor(SESSIONS.k7, "fred@parapluie.org")).toBe(
      "k7:fred_parapluie_org",
    );
  });

  // The collision this exists to end: two people on the SAME engine must not share a project.
  it("separates two people on one service", () => {
    expect(sessionFor("k7", "a@x.org")).not.toBe(sessionFor("k7", "b@x.org"));
  });

  it("separates one person's services", () => {
    expect(sessionFor("k7", "a@x.org")).not.toBe(sessionFor("pl8", "a@x.org"));
  });

  // A surface with no user — a deck on the machine in front of you — is unchanged.
  it("gives back the bare service with no user", () => {
    for (const who of [undefined, null, ""])
      expect(sessionFor("m9", who)).toBe("m9");
  });
});

describe("forSession", () => {
  it("reads a frame addressed to it", () => {
    expect(forSession({ session: "k7:a" }, "k7:a")).toBe(true);
  });

  it("drops another session's frame", () => {
    expect(forSession({ session: "k7:b" }, "k7:a")).toBe(false);
  });

  // DISAGREEMENT, not absence: an engine older than sessions stamps nothing, so requiring the field would make a new client deaf.
  it("lets an unstamped frame through", () => {
    expect(forSession({}, "k7:a")).toBe(true);
    expect(forSession({ session: undefined }, DEFAULT_SESSION)).toBe(true);
  });

  // An old client sends no session and the engine stamps its replies "", which is what that client drives; the two must still agree.
  it("keeps the default session's own frames", () => {
    expect(forSession({ session: "" }, DEFAULT_SESSION)).toBe(true);
  });
});

// The two tables ARE the contract: "unstamped" is a closed set, and a reply that moves between them has to move here first.
describe("the stamped/unstamped sets", () => {
  it("does not put a reply in both", () => {
    const global = new Set<string>(ENGINE_GLOBAL_REPLIES);
    for (const type of PER_SESSION_REPLIES)
      expect(global.has(type)).toBe(false);
  });

  // Frames are built as VARIABLES, not literals: a literal carrying `type` too would trip excess-property checking, where a real caller does not.
  const frame = (
    type: string,
    session?: string,
  ): { type: string; session?: string } => ({ type, session });

  it("drops every per-session reply that belongs to someone else", () => {
    for (const type of PER_SESSION_REPLIES)
      expect(forSession(frame(type, "k7:b"), "k7:a")).toBe(false);
  });

  it("keeps every per-session reply of its own", () => {
    for (const type of PER_SESSION_REPLIES)
      expect(forSession(frame(type, "k7:a"), "k7:a")).toBe(true);
  });

  it("lets every engine-global reply through unstamped", () => {
    for (const type of ENGINE_GLOBAL_REPLIES)
      expect(forSession(frame(type), "k7:a")).toBe(true);
  });
});

// The engine's handlers are where a reply is stamped or not; this reads them, so a new verb cannot ship unclassified.
describe("the engine's own send sites", () => {
  const dir = join(import.meta.dirname, "../../engine/k7-runtime/server");
  const source = readdirSync(dir)
    .filter((f) => /\.(cpp|h)$/.test(f))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
  const sites = (verb: RegExp): string[] =>
    [...source.matchAll(verb)].map((m) => m[1]);
  const unstamped = [
    ...sites(
      /\b(?:broadcast|broadcastLocal)\(\s*(?:json)?\{\{"type",\s*"([a-z-]+)"/g,
    ),
    ...sites(/\bsendTo\([^,]+,\s*(?:json)?\{\{"type",\s*"([a-z-]+)"/g),
  ];
  const stamped = sites(
    /\bbroadcastTo\(\s*\w+,\s*(?:json)?\{\{"type",\s*"([a-z-]+)"/g,
  );

  // A scan that finds nothing passes everything, so it must keep finding what it finds today.
  it("finds the send sites", () => {
    expect(unstamped.length).toBeGreaterThanOrEqual(8);
    expect(stamped.length).toBeGreaterThanOrEqual(8);
  });

  it("classifies every unstamped reply as engine-global", () => {
    const global = new Set<string>(ENGINE_GLOBAL_REPLIES);
    expect(unstamped.filter((t) => !global.has(t))).toEqual([]);
  });

  it("classifies every stamped reply as per-session", () => {
    const perSession = new Set<string>(PER_SESSION_REPLIES);
    expect(stamped.filter((t) => !perSession.has(t))).toEqual([]);
  });
});
