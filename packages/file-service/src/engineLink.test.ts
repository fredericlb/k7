// The one test that stops l8' two halves from drifting apart.
//
// The browser drives transport, this service compiles and sends the song. They address the
// same project only if they spell its session identically — and a mismatch raises nothing
// on either side: the song plays in one session while the frontend steers an empty other,
// which reads as "the engine ignores Play". Nothing else in the repo would catch that.

import { join } from "node:path";
import { SESSIONS, sessionFor } from "@studio/engine-protocol/sessions";
import { describe, expect, it } from "vitest";
import { sessionOf } from "./engineLink.ts";
import { rootDir, slugify } from "./slug.ts";

const wsFor = (email: string, name = "songs") => ({
  root: join(rootDir(), slugify(email), name),
});

describe("sessionOf", () => {
  // THE agreement. This side reads the owner slug out of the workspace path; the browser
  // slugs the logged-in email. Both must land on the same string.
  it("matches what the browser half computes from the same email", () => {
    for (const email of [
      "fred@parapluie.org",
      "a.b+c@example.co.uk",
      "UPPER@Example.COM",
    ])
      expect(sessionOf(wsFor(email))).toBe(sessionFor(SESSIONS.l8, email));
  });

  it("separates two people, and joins one person's workspaces", () => {
    expect(sessionOf(wsFor("a@x.org"))).not.toBe(sessionOf(wsFor("b@x.org")));
    // Same person, two workspaces: ONE session. A person drives one project at a time, and
    // splitting per workspace would leave a stopped project loaded in the engine forever.
    expect(sessionOf(wsFor("a@x.org", "one"))).toBe(
      sessionOf(wsFor("a@x.org", "two")),
    );
  });

  // A bare folder opened directly (rootIsProject) has no owner in its path. One machine,
  // one person — the case that shape exists for — so the bare service id is right.
  it("falls back to the bare service id outside the users root", () => {
    expect(sessionOf({ root: join("/tmp", "some-song") })).toBe(SESSIONS.l8);
    expect(sessionOf(null)).toBe(SESSIONS.l8);
  });
});
