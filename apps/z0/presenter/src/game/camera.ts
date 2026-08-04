const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

export function createCamera() {
  let cameraVT = 0;
  let camAnimStart = -1;
  let camAnimDuration = 1.8;
  let camAnimFrom = 0;
  let camAnimTo = 0;
  let camAnimOnComplete: (() => void) | null = null;

  const startCamAnim = (
    to: number,
    duration: number,
    onComplete?: () => void,
  ) => {
    camAnimFrom = cameraVT;
    camAnimTo = to;
    camAnimDuration = duration;
    camAnimStart = performance.now() / 1000;
    camAnimOnComplete = onComplete ?? null;
  };

  const updateCamera = (now: number): number => {
    if (camAnimStart >= 0) {
      const raw = Math.min((now - camAnimStart) / camAnimDuration, 1);
      cameraVT = camAnimFrom + (camAnimTo - camAnimFrom) * easeInOutCubic(raw);
      if (raw >= 1) {
        cameraVT = camAnimTo;
        camAnimStart = -1;
        const cb = camAnimOnComplete;
        camAnimOnComplete = null;
        if (cb) cb();
      }
    }
    return cameraVT;
  };

  return { startCamAnim, updateCamera };
}
