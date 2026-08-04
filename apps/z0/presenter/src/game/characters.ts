import { fnv1a, genCharFeatures, mulberry32 } from "../canvas/drawCharacter";
import type { CharState } from "../types/game";

export function createCharacters() {
  const charStates = new Map<string, CharState>();

  const ensureCharState = (name: string, W: number) => {
    if (charStates.has(name)) return;
    const rng = mulberry32(fnv1a(name) ^ 0xdeadbeef);
    charStates.set(name, {
      x: W * (0.1 + rng() * 0.8),
      vx: (rng() > 0.5 ? 1 : -1) * (25 + rng() * 35),
      legPhase: rng() * Math.PI * 2,
      changeTimer: 1.5 + rng() * 3,
      features: genCharFeatures(name),
    });
  };

  const updateCharacters = (dt: number, W: number) => {
    for (const cs of charStates.values()) {
      cs.x += cs.vx * dt;
      cs.legPhase += Math.abs(cs.vx) * dt * 0.07;
      const halfW = 22;
      if (cs.x < halfW) {
        cs.x = halfW;
        cs.vx = Math.abs(cs.vx);
      }
      if (cs.x > W - halfW) {
        cs.x = W - halfW;
        cs.vx = -Math.abs(cs.vx);
      }
      cs.changeTimer -= dt;
      if (cs.changeTimer <= 0) {
        cs.vx = (Math.random() > 0.5 ? 1 : -1) * (25 + Math.random() * 35);
        cs.changeTimer = 1.5 + Math.random() * 4;
      }
    }
  };

  return { charStates, ensureCharState, updateCharacters };
}
