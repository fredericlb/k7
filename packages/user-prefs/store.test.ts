// Tests for the per-user preference store. The filename rule is what these pin: it is the
// difference between two users sharing a preference and not, and it is not observable from
// the outside once it is wrong.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileFor, prefsStore } from "./store.ts";

describe("fileFor", () => {
  it("keeps a plain subject readable", () => {
    expect(fileFor("dev-user")).toMatch(/^dev-user-[0-9a-f]{12}\.json$/);
  });

  // A sub is an opaque IdP string: a path escape, an illegal Windows name, an overlong one.
  it("never lets a subject become a path", () => {
    for (const sub of ["../../etc/passwd", "a/b", "c:\\x", "a".repeat(500)]) {
      const name = fileFor(sub);
      expect(name).not.toContain("/");
      expect(name).not.toContain("\\");
      expect(name).not.toContain("..");
      expect(name.length).toBeLessThan(80);
    }
  });

  // Without the hash, "a/b" and "a_b" would be the same user: the slug is only for reading.
  it("separates subjects that slug the same", () => {
    expect(fileFor("a/b")).not.toEqual(fileFor("a_b"));
    expect(fileFor("a".repeat(60))).not.toEqual(fileFor("a".repeat(61)));
  });
});

describe("prefsStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "prefs-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips, and each subject has its own", () => {
    const s = prefsStore<{ engineId?: string }>(dir);
    s.write("alice", { engineId: "e1" });
    s.write("bob", { engineId: "e2" });
    expect(s.read("alice")).toEqual({ engineId: "e1" });
    expect(s.read("bob")).toEqual({ engineId: "e2" });
  });

  it("reads null for someone who has never saved", () => {
    expect(prefsStore(dir).read("nobody")).toBeNull();
  });

  // An unmounted directory answers as a first login: a missing volume must not be a 500.
  it("reads null rather than throwing on an absent directory", () => {
    expect(prefsStore(join(dir, "not-mounted")).read("alice")).toBeNull();
  });

  it("replaces wholesale, so a field can be cleared", () => {
    const s = prefsStore<{ engineId?: string }>(dir);
    s.write("alice", { engineId: "e1" });
    s.write("alice", {});
    expect(s.read("alice")).toEqual({});
  });
});
