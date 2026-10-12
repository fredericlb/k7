// The browser's full screen, for ONE element rather than the page — how a score fills a tablet.
// Safari has only ever had the prefixed spelling, hence the two of everything.

import { type RefObject, useCallback, useEffect, useState } from "react";

/** What WebKit calls the same four things — declared here rather than widened into lib.dom. */
interface WebkitFullscreen {
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
}

const doc = () => document as Document & WebkitFullscreen;
const current = (): Element | null =>
  doc().fullscreenElement ?? doc().webkitFullscreenElement ?? null;

export interface ElementFullscreen {
  /** False on iPhone Safari, which has the API for `<video>` alone — the button is then not drawn. */
  available: boolean;
  active: boolean;
  toggle: () => void;
}

/** Whether `target` is the element in full screen, and the verb that flips it. Must be called from a gesture. */
export function useElementFullscreen(
  target: RefObject<HTMLElement | null>,
): ElementFullscreen {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const sync = () =>
      setActive(!!target.current && current() === target.current);
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, [target]);

  const toggle = useCallback(() => {
    const el = target.current as (HTMLElement & WebkitFullscreen) | null;
    if (!el) return;
    const d = doc();
    const call =
      current() === el
        ? (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.())
        : (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
    // These reject on a stale gesture or a refusing device, and neither is worth a message.
    void Promise.resolve(call).catch(() => undefined);
  }, [target]);

  const available =
    typeof document !== "undefined" &&
    (doc().fullscreenEnabled || !!doc().webkitFullscreenEnabled);

  return { available, active, toggle };
}
