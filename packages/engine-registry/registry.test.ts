// registry.test.ts — the claim's three rules, and the one property that makes takeover
// survivable: a renewal is not an open. docs/claim.md is the prose; this is the contract.
//
// Every bug this pins is a LIFECYCLE bug, the blind spot docs/audit-moteur.md §E names for this
// area's tests: a pure policy is easy to cover, what happens to a claim over time is not.

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
      reg.claim("e1", { project: "band/winter.st0", holder: "a" }),
    );
    expect(g.secret).toBeTruthy();
    expect(g.tookOver).toBeUndefined();

    const again = grant(
      reg.claim("e1", {
        project: "band/winter.st0",
        holder: "a",
        secret: g.secret,
      }),
    );
    expect(again.secret).toBe(g.secret); // the same hold, not a second one
    expect(reg.engineForProject("band/winter.st0")).toBe("e1");
  });

  it("lets the newcomer take a project, and REFUSES the loser's next renewal", () => {
    const first = grant(reg.claim("e1", { project: "p", holder: "alice" }));
    const second = reg.claim("e1", { project: "p", holder: "bob" });
    expect(second.ok).toBe(true);
    expect(grant(second).tookOver).toEqual({ holder: "alice", project: "p" });

    // The whole reason a claim carries a secret: alice renewing must NOT win it back, or the two trade the project for ever.
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
      reg.claim("e1", { project: "band/winter.st0", holder: "a" }),
    );
    grant(reg.claim("e1", { project: "band/leclip.st0", holder: "b" }));

    // Not tidiness: the file service keeps a single active project per machine, so a second one clobbers it.
    const refused = reg.claim("e1", {
      project: "band/winter.st0",
      holder: "a",
      secret: song.secret,
    });
    expect(refused.ok).toBe(false);
  });

  it("lets ONE account hold one project twice on one engine — a surface beside its editor", () => {
    const editor = grant(
      reg.claim("e1", { project: "band/winter.st0", holder: "a" }),
    );
    // The tablet: same account and same engine, so the same session and the same loaded project, which rule 1 has nothing to protect.
    const surface = grant(
      reg.claim("e1", { project: "band/winter.st0", holder: "a" }),
    );
    expect(surface.tookOver).toBeUndefined();

    // Both keep renewing, and neither is told its project was opened elsewhere.
    for (const secret of [editor.secret, surface.secret])
      expect(
        grant(
          reg.claim("e1", {
            project: "band/winter.st0",
            holder: "a",
            secret,
          }),
        ).secret,
      ).toBe(secret);
  });

  it("still takes that project from ANOTHER account on the same engine", () => {
    const mine = grant(reg.claim("e1", { project: "p", holder: "alice" }));
    const theirs = reg.claim("e1", { project: "p", holder: "bob" });
    expect(grant(theirs).tookOver).toEqual({ holder: "alice", project: "p" });
    expect(
      reg.claim("e1", { project: "p", holder: "alice", secret: mine.secret })
        .ok,
    ).toBe(false);
  });

  it("still moves that project when the SAME account opens it on another engine", () => {
    // The exemption is same account AND same engine: a second machine is a second session, so the project really does move.
    const onE1 = grant(reg.claim("e1", { project: "p", holder: "alice" }));
    grant(reg.claim("e2", { project: "p", holder: "alice" }));
    const refused = reg.claim("e1", {
      project: "p",
      holder: "alice",
      secret: onE1.secret,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.lost).toBe("project");
  });

  it("still evicts a DIFFERENT project of the same account on one engine", () => {
    // Rule 2 is untouched by the exemption: one project per engine is what the file service requires, whoever is asking.
    const winter = grant(
      reg.claim("e1", { project: "band/winter.st0", holder: "a" }),
    );
    grant(reg.claim("e1", { project: "band/leclip.st0", holder: "a" }));
    const refused = reg.claim("e1", {
      project: "band/winter.st0",
      holder: "a",
      secret: winter.secret,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.lost).toBe("engine");
      expect(refused.tookFor).toBe("band/leclip.st0");
    }
  });

  it("lets a project-less holder sit beside a project — pl8 must not evict st0", () => {
    const song = grant(
      reg.claim("e1", { project: "band/winter.st0", holder: "a" }),
    );
    // pl8 drives an engine and opens no project, so looking at the catalogue must not take the song away from the st0 tab beside it.
    const catalogue = grant(reg.claim("e1", { project: null, holder: "a" }));

    expect(
      grant(
        reg.claim("e1", {
          project: "band/winter.st0",
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
    expect(reg.engineForProject("band/winter.st0")).toBe("e1");
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

    // Alice's tab beacons its goodbye with a stale secret; taking the engine token instead would drop BOB's claim while he is driving.
    reg.release("e1", alice.secret);
    expect(reg.engineForProject("p")).toBe("e1");
    reg.release("e1", bob.secret);
    expect(reg.engineForProject("p")).toBeUndefined();
  });

  it("names the holder and the project in the list, so a picker can say which", () => {
    grant(reg.claim("e1", { project: "band/winter.st0", holder: "alice" }));
    const row = reg.list().find((e) => e.id === "e1");
    expect(row?.heldBy).toBe("alice");
    expect(row?.heldProject).toBe("band/winter.st0");
  });

  /** The three refusals are three different sentences on screen, which is the whole point of `lost` — see docs/claim.md. */
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
        reg.claim("e1", { project: "band/winter.st0", holder: "alice" }),
      );
      grant(reg.claim("e1", { project: "band/leclip.st0", holder: "bob" }));

      const r = reg.claim("e1", {
        project: "band/winter.st0",
        holder: "alice",
        secret: mine.secret,
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      // Naming it is what lets the tab offer "pick another engine" instead of a wrong apology.
      expect(r.lost).toBe("engine");
      expect(r.heldBy).toBe("bob");
      expect(r.tookFor).toBe("band/leclip.st0");
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
      grant(reg.claim("e1", { project: "band/winter.st0", holder: "b" }));

      const r = reg.claim("e1", {
        project: null,
        holder: "a",
        secret: catalogue.secret,
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      // NOT `engine`: pl8 sitting beside a song is legal, so that song took nothing from it and only the TTL did.
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

describe("the performance rating", () => {
  it("is listed as the heartbeat carried it, and absent when it carried none", () => {
    const reg = createRegistry();
    const performance = {
      score: 1240,
      cores: 8,
      singleThread: 70,
      diskWriteMBps: 900,
      fsyncPerSec: null,
      memoryGB: 16,
    };
    reg.upsert({
      id: "rated",
      token: "t",
      hostname: "rated",
      machineFingerprint: "fp",
      addresses: {
        loopback: "127.0.0.1",
        lanIps: [],
        port: 8765,
      },
      performance,
    });
    beat(reg, "older");
    const byId = new Map(reg.list().map((e) => [e.id, e]));
    expect(byId.get("rated")?.performance).toEqual(performance);
    expect(byId.get("older")?.performance).toBeUndefined();
  });
});
