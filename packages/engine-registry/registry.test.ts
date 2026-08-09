// registry.test.ts — the claim's three rules, and the one property that makes takeover
// survivable: a renewal is not an open. docs/claim.md is the prose; this is the contract.
//
// Every bug this pins is a LIFECYCLE bug, which docs/audit-moteur.md §E names as the whole
// blind spot of this area's tests: the pure policies were covered and nothing that happens to a
// claim over time was.

import { ENGINE_ASSIGN_TTL_MS } from "@studio/web-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRegistry, type EngineRegistry } from "./registry.ts";

const beat = (reg: EngineRegistry, id: string) =>
  reg.upsert({
    id,
    token: `tok-${id}`,
    hostname: id,
    machineFingerprint: `fp-${id}`,
    addresses: {
      loopback: "127.0.0.1",
      lanIps: [],
      port: 8765,
      filePort: 8770,
    },
  });

/** A successful claim's secret, or a failure — narrowed, since the union is the point. */
const grant = (r: ReturnType<EngineRegistry["claim"]>) => {
  if (!r.ok) throw new Error(`expected a grant, got heldBy=${r.heldBy}`);
  return r;
};

describe("the engine claim", () => {
  let reg: EngineRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    reg = createRegistry();
    beat(reg, "e1");
    beat(reg, "e2");
  });
  afterEach(() => vi.useRealTimers());

  it("grants an open, and renews it with the secret it gave back", () => {
    const g = grant(
      reg.claim("e1", { project: "band/winter.l8", holder: "a" }),
    );
    expect(g.secret).toBeTruthy();
    expect(g.tookOver).toBeUndefined();

    const again = grant(
      reg.claim("e1", {
        project: "band/winter.l8",
        holder: "a",
        secret: g.secret,
      }),
    );
    expect(again.secret).toBe(g.secret); // the same hold, not a second one
    expect(reg.engineForProject("band/winter.l8")).toBe("e1");
  });

  it("lets the newcomer take a project, and REFUSES the loser's next renewal", () => {
    const first = grant(reg.claim("e1", { project: "p", holder: "alice" }));
    const second = reg.claim("e1", { project: "p", holder: "bob" });
    expect(second.ok).toBe(true);
    expect(grant(second).tookOver).toEqual({ holder: "alice", project: "p" });

    // The whole reason a claim carries a secret: alice renewing must NOT win it back, or the
    // two trade the project every five seconds for ever.
    const refused = reg.claim("e1", {
      project: "p",
      holder: "alice",
      secret: first.secret,
    });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.heldBy).toBe("bob");

    // …and bob is untouched by the refusal.
    expect(
      grant(
        reg.claim("e1", {
          project: "p",
          holder: "bob",
          secret: grant(second).secret,
        }),
      ).secret,
    ).toBe(grant(second).secret);
  });

  it("moves a project between engines rather than letting it run on two", () => {
    const onE1 = grant(reg.claim("e1", { project: "p", holder: "alice" }));
    grant(reg.claim("e2", { project: "p", holder: "bob" }));

    expect(reg.engineForProject("p")).toBe("e2");
    expect(
      reg.claim("e1", { project: "p", holder: "alice", secret: onE1.secret })
        .ok,
    ).toBe(false);
  });

  it("refuses a SECOND project on one engine — the file service holds only one", () => {
    const song = grant(
      reg.claim("e1", { project: "band/winter.l8", holder: "a" }),
    );
    grant(reg.claim("e1", { project: "band/leclip.v1", holder: "b" }));

    // Not tidiness: `engineLink.ts` keeps a single active project per machine and says so
    // ("several browser tabs share it — last write wins"). A second one clobbers.
    const refused = reg.claim("e1", {
      project: "band/winter.l8",
      holder: "a",
      secret: song.secret,
    });
    expect(refused.ok).toBe(false);
  });

  it("lets a project-less holder sit beside a project — st0 must not evict l8", () => {
    const song = grant(
      reg.claim("e1", { project: "band/winter.l8", holder: "a" }),
    );
    // st0 drives an engine and opens no project. Looking at the catalogue used to be enough to
    // take the song away from the l8 tab on the same machine.
    const catalogue = grant(reg.claim("e1", { project: null, holder: "a" }));

    expect(
      grant(
        reg.claim("e1", {
          project: "band/winter.l8",
          holder: "a",
          secret: song.secret,
        }),
      ).secret,
    ).toBe(song.secret);
    expect(
      grant(
        reg.claim("e1", {
          project: null,
          holder: "a",
          secret: catalogue.secret,
        }),
      ).secret,
    ).toBe(catalogue.secret);
    expect(reg.engineForProject("band/winter.l8")).toBe("e1");
  });

  it("forgets a hold nobody renewed, without anyone saying goodbye", () => {
    grant(reg.claim("e1", { project: "p", holder: "alice" }));
    expect(reg.list()[0].assigned).toBe(true);

    // The tab crashed. Nothing releases, and that is the case the TTL exists for.
    vi.advanceTimersByTime(ENGINE_ASSIGN_TTL_MS + 1);
    beat(reg, "e1"); // the ENGINE is still alive and beating; only the holder went
    expect(reg.list()[0].assigned).toBe(false);
    expect(reg.engineForProject("p")).toBeUndefined();
  });

  it("releases only the hold whose secret is presented", () => {
    const alice = grant(reg.claim("e1", { project: "p", holder: "alice" }));
    const bob = grant(reg.claim("e1", { project: "p", holder: "bob" })); // takes it from alice

    // Alice's tab closes and beacons its goodbye — with a secret that is no longer the holder's.
    // If release took the engine token instead, this would drop BOB's claim and he would read
    // free in every picker while still driving.
    reg.release("e1", alice.secret);
    expect(reg.engineForProject("p")).toBe("e1");
    reg.release("e1", bob.secret);
    expect(reg.engineForProject("p")).toBeUndefined();
  });

  it("names the holder and the project in the list, so a picker can say which", () => {
    grant(reg.claim("e1", { project: "band/winter.l8", holder: "alice" }));
    const row = reg.list().find((e) => e.id === "e1");
    expect(row?.heldBy).toBe("alice");
    expect(row?.heldProject).toBe("band/winter.l8");
  });

  /**
   * The three refusals are three different sentences on screen, and telling them apart is the
   * whole point of `lost`: l8 used to say "this project was opened elsewhere" for all three,
   * which is false twice out of three. See docs/claim.md.
   */
  describe("says WHY the claim is gone", () => {
    it("`project` — the same project, taken by somebody else", () => {
      const mine = grant(reg.claim("e1", { project: "p", holder: "alice" }));
      grant(reg.claim("e2", { project: "p", holder: "bob" }));

      const r = reg.claim("e1", {
        project: "p",
        holder: "alice",
        secret: mine.secret,
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.lost).toBe("project");
      expect(r.heldBy).toBe("bob");
    });

    it("`engine` — a DIFFERENT project took the machine, and it is named", () => {
      const mine = grant(
        reg.claim("e1", { project: "band/winter.l8", holder: "alice" }),
      );
      grant(reg.claim("e1", { project: "band/leclip.v1", holder: "bob" }));

      const r = reg.claim("e1", {
        project: "band/winter.l8",
        holder: "alice",
        secret: mine.secret,
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      // Naming it is what lets the tab offer "pick another engine" instead of a wrong apology.
      expect(r.lost).toBe("engine");
      expect(r.heldBy).toBe("bob");
      expect(r.tookFor).toBe("band/leclip.v1");
    });

    it("`lapsed` — nobody took anything; the claim just aged out", () => {
      const mine = grant(reg.claim("e1", { project: "p", holder: "alice" }));

      // A sleep, or a network gap longer than the TTL. The engine is still beating.
      vi.advanceTimersByTime(ENGINE_ASSIGN_TTL_MS + 1);
      beat(reg, "e1");

      const r = reg.claim("e1", {
        project: "p",
        holder: "alice",
        secret: mine.secret,
      });
      // An open would be granted here; a RENEWAL is refused, because the secret is stale.
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.lost).toBe("lapsed");
      expect(r.heldBy).toBe("");
    });

    it("`lapsed` for a project-LESS holder, however busy the engine has since become", () => {
      const catalogue = grant(reg.claim("e1", { project: null, holder: "a" }));
      vi.advanceTimersByTime(ENGINE_ASSIGN_TTL_MS + 1);
      beat(reg, "e1");
      grant(reg.claim("e1", { project: "band/winter.l8", holder: "b" }));

      const r = reg.claim("e1", {
        project: null,
        holder: "a",
        secret: catalogue.secret,
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      // NOT `engine`: st0 sitting beside a song is legal, so that song never took anything
      // from it. Only the TTL did. Telling st0 a project evicted it would be an invented cause.
      expect(r.lost).toBe("lapsed");
    });

    it("`lapsed` too when the engine itself went away — nobody displaced us", () => {
      const mine = grant(reg.claim("e1", { project: "p", holder: "alice" }));
      reg.remove("e1", "tok-e1");

      const r = reg.claim("e1", {
        project: "p",
        holder: "alice",
        secret: mine.secret,
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.lost).toBe("lapsed");
    });
  });

  it("keeps holders across a heartbeat — an engine beats every 5s, a claim lives 15", () => {
    const g = grant(reg.claim("e1", { project: "p", holder: "alice" }));
    beat(reg, "e1");
    expect(
      grant(
        reg.claim("e1", { project: "p", holder: "alice", secret: g.secret }),
      ).secret,
    ).toBe(g.secret);
  });
});
