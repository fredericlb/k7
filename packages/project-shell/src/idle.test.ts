import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_TIMEOUT_MS, idleForMs, markActive, sleepMove } from "./idle.ts";

// A clock held by hand: the hook mounts a component, which no suite here does.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T10:00:00Z"));
  markActive();
});
afterEach(() => vi.useRealTimers());

describe("l'horloge d'inactivité", () => {
  it("compte depuis le dernier geste, pas depuis le montage", () => {
    vi.advanceTimersByTime(5 * 60_000);
    expect(idleForMs()).toBe(5 * 60_000);
    markActive();
    expect(idleForMs()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(idleForMs()).toBe(60_000);
  });

  it("dit la vérité au réveil d'une machine endormie", () => {
    // Two hours during which no timer ran must read as two hours, not as "19 minutes left".
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    expect(idleForMs()).toBe(2 * 60 * 60_000);
    expect(idleForMs()).toBeGreaterThan(IDLE_TIMEOUT_MS);
  });

  it("vingt minutes, et le seuil n'est pas franchi une seconde avant", () => {
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1000);
    expect(idleForMs()).toBeLessThan(IDLE_TIMEOUT_MS);
    vi.advanceTimersByTime(1000);
    expect(idleForMs()).toBe(IDLE_TIMEOUT_MS);
  });
});

describe("s'endormir parce qu'on est passé derrière", () => {
  it("un projet ouvert qui sort de vue s'endort", () => {
    expect(sleepMove(true, { k: "open" })).toBe("sleep");
  });

  it("un onglet revenu devant se réveille seul", () => {
    expect(sleepMove(false, { k: "idle", why: "hidden" })).toBe("wake");
  });

  it("une session fermée par le MINUTEUR ne se réveille pas seule", () => {
    // The case that decides: without `why`, coming back to this tab would undo the whole sleep.
    expect(sleepMove(false, { k: "idle", why: "timeout" })).toBe(null);
  });

  it("ne touche à rien pendant que le gate résout, clone ou explique", () => {
    for (const k of ["resolving", "cloning", "missing", "taken"]) {
      expect(sleepMove(true, { k })).toBe(null);
      expect(sleepMove(false, { k })).toBe(null);
    }
  });

  it("rester devant un projet ouvert ne fait rien, et rester derrière non plus", () => {
    expect(sleepMove(false, { k: "open" })).toBe(null);
    expect(sleepMove(true, { k: "idle", why: "hidden" })).toBe(null);
  });
});
