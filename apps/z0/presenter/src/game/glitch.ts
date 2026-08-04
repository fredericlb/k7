import type { GlitchState } from "../types/game";

export function createGlitch() {
  const glitchStates = new Map<string, GlitchState>();

  const updateGlitch = (dt: number, playerNames: string[]) => {
    for (const name of playerNames) {
      if (!glitchStates.has(name)) {
        glitchStates.set(name, {
          ox: 0,
          oy: 0,
          timer: 1 + Math.random() * 3,
          active: false,
        });
      }
    }
    for (const gs of glitchStates.values()) {
      gs.timer -= dt;
      if (gs.timer <= 0) {
        if (gs.active) {
          gs.active = false;
          gs.ox = gs.oy = 0;
          gs.timer = 0.5 + Math.random() * 4;
        } else {
          gs.active = true;
          gs.ox = (Math.random() - 0.5) * 18;
          gs.oy = (Math.random() - 0.5) * 5;
          gs.timer = 0.05 + Math.random() * 0.12;
        }
      }
    }
  };

  return { glitchStates, updateGlitch };
}
