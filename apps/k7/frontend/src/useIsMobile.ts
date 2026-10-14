// useIsMobile.ts — is the shell on a phone-sized surface? Width OR height, because a phone
// in landscape passes a width-only test but is far too short for the desktop layout — which
// also makes it testable by resizing a window. Deliberately NOT `pointer: coarse`: a
// touchscreen laptop is not a phone.

import { useEffect, useState } from "react";

export const MOBILE_QUERY = "(max-width: 820px), (max-height: 520px)";

export function useIsMobile(): boolean {
  // Read synchronously: correcting in an effect would build the desktop layout's stacked panes for one frame.
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    onChange(); // in case it changed between the first render and this effect
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}
