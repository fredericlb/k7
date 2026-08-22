import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_TIMEOUT_MS, idleForMs, markActive } from "./idle.ts";

// Une horloge tenue à la main : c'est tout le sujet du module, et la seule chose qu'un test node
// peut voir de lui — le hook monte un composant, ce qu'aucune suite d'ici ne fait.
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
    // Le cas qui décide de la date contre le `setTimeout` : deux heures pendant lesquelles aucun
    // minuteur n'a tourné doivent se lire comme deux heures, pas comme « il reste 19 minutes ».
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
