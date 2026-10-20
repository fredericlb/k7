// listenGate.test.ts — a standalone listens once the first library ensure settles, a failure
// included, and never later than the deadline.

import type { LibraryNote } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { awaitLibraries } from "./listenGate.ts";

const later = <T>(ms: number, value: T): Promise<T> =>
  new Promise((ok) => setTimeout(() => ok(value), ms));

describe("awaitLibraries", () => {
  it("resolves only once the ensure has settled", async () => {
    const seeded: LibraryNote[] = [
      { name: "k7-core", state: "seeded", note: "copied from the bundle" },
    ];
    let done = false;
    const gate = awaitLibraries(later(80, seeded), () => {}, 5_000).then(
      (o) => {
        done = true;
        return o;
      },
    );
    await later(30, null);
    expect(done).toBe(false);
    expect(await gate).toEqual({ state: "settled", notes: seeded });
  });

  it("lets a failed install through, and says which library and why", async () => {
    const logged: string[] = [];
    const out = await awaitLibraries(
      Promise.resolve<LibraryNote[]>([
        { name: "k7-core", state: "failed", note: "ENOSPC" },
      ]),
      (m) => logged.push(m),
    );
    expect(out.state).toBe("settled");
    expect(logged).toEqual([
      "libraries | 'k7-core' could not be installed: ENOSPC",
    ]);
  });

  it("turns a thrown ensure into a failed note rather than holding the start", async () => {
    const out = await awaitLibraries(
      Promise.reject(new Error("disk gone")),
      () => {},
    );
    expect(out).toEqual({
      state: "settled",
      notes: [{ name: "libraries", state: "failed", note: "disk gone" }],
    });
  });

  it("gives up waiting at the deadline, so a slow copy never hangs the app", async () => {
    const logged: string[] = [];
    const out = await awaitLibraries(
      new Promise<LibraryNote[]>(() => {}),
      (m) => logged.push(m),
      50,
    );
    expect(out).toEqual({ state: "late" });
    expect(logged[0]).toMatch(/still installing/);
  });
});
