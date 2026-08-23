import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_TIMEOUT_MS, idleForMs, markActive } from "./idle.ts";

// A clock held by hand: that is the module's whole subject, and the only part of it a node test
// can see — the hook mounts a component, which no suite here does.
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
    // The case that settles the date against `setTimeout`: two hours during which no timer ran
    // must read as two hours, not as "19 minutes left".
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
