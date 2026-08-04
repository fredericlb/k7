import type { Particle } from "../types/game";

export function createParticles() {
  const particles: Particle[] = [];

  const initParticles = (W: number, sceneH: number) => {
    particles.length = 0;
    for (let i = 0; i < 200; i++) {
      particles.push({
        x: Math.random() * W,
        y: Math.random() * sceneH,
        speed: 0.3 + Math.random() * 0.5,
      });
    }
  };

  return { particles, initParticles };
}
