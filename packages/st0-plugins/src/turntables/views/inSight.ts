// inSight.ts — whether the desk is on screen. It is a pane, hidden rather than unmounted, and its
// meters and its turning records have nothing to show anyone while hidden: they read this and go
// still, then pick up where the engine is when the desk comes back. See ../../../docs/turntables/hosting.md.

import {
  createContext,
  type RefObject,
  useContext,
  useEffect,
  useState,
} from "react";

/** True unless the desk's root says otherwise — so a view mounted outside the desk keeps drawing. */
export const InSightContext = createContext(true);

/** Is the desk on screen? Meters and loops read it to go still while hidden. */
export const useInSight = (): boolean => useContext(InSightContext);

/** Watch an element: `display: none` reads as out of sight, which is exactly how a hidden pane is hidden. */
export function useWatchSight(ref: RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) =>
      setSeen(entries.some((e) => e.isIntersecting)),
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return seen;
}
