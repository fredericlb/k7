// useFullscreen.ts — the browser's own fullscreen, which is how a surface loses its address bar
// on a device that could not install it. Unlike a service worker this needs NO secure context,
// only a gesture, so it is the half of "an app" a tablet reaching this machine over the LAN can
// still have. Safari has only ever had the prefixed spelling, hence the two of everything.
// See ../../docs/external.md.

import { useCallback, useEffect, useState } from "react";

/** What WebKit calls the same four things — declared here rather than widened into lib.dom. */
interface WebkitFullscreen {
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
}

const root = () => document.documentElement as HTMLElement & WebkitFullscreen;
const doc = () => document as Document & WebkitFullscreen;

const isOn = (): boolean =>
  !!(doc().fullscreenElement ?? doc().webkitFullscreenElement);

export interface Fullscreen {
  /** False on iPhone Safari, which has the API for `<video>` alone — the button is then not drawn. */
  available: boolean;
  active: boolean;
  toggle: () => void;
}

/** The document's fullscreen state, and the one verb worth exposing. Must be called from a gesture. */
export function useFullscreen(): Fullscreen {
  const [active, setActive] = useState(isOn);

  useEffect(() => {
    const sync = () => setActive(isOn());
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  const toggle = useCallback(() => {
    const d = doc();
    const r = root();
    const call = isOn()
      ? (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.())
      : (r.requestFullscreen?.() ?? r.webkitRequestFullscreen?.());
    // These reject on a stale gesture or a refusing device, and neither is worth a message.
    void Promise.resolve(call).catch(() => undefined);
  }, []);

  const available =
    typeof document !== "undefined" &&
    (doc().fullscreenEnabled || !!doc().webkitFullscreenEnabled);

  return { available, active, toggle };
}
