// useViewRoute.ts — keep the shell's screen (full/panel/help/builder) and the browser's URL
// in step, both directions, without lifting a dozen writers into route components. The
// hazard is a feedback loop between the layout and passive effects, so both decisions are
// pure functions tested as a SEQUENCE. See docs/shellRouting.md.

import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  type Declared,
  fromLocation,
  type RouteState,
  sameRoute,
  toPath,
} from "./routes";

/** URL → state: the screen the address names, or null when the state already shows it — `declared` is what the PROJECT says it draws. */
export function stateForLocation(
  pathname: string,
  search: string,
  state: RouteState,
  declared: Declared = {},
): RouteState | null {
  const next = fromLocation(pathname, search, declared);
  return sameRoute(next, state) ? null : next;
}

/** state → URL: nothing is written when the screen did not change, nor when the URL already says so — which is what makes a deep link survive. */
export function urlForState(
  state: RouteState,
  prev: RouteState,
  pathname: string,
  search: string,
  declared: Declared = {},
): string | null {
  if (sameRoute(state, prev)) return null;
  const url = fromLocation(pathname, search, declared);
  if (sameRoute(state, url)) return null;
  // The current search goes IN so that what this router does not own comes back out.
  return toPath(state, search);
}

/** Drive `state` from the URL and back — the caller owns the state; this only decides when each side should follow the other. */
export function useViewRoute(
  state: RouteState,
  apply: (next: RouteState) => void,
  /** What the open project declares, plus whether this is a snapshot — see `stateForLocation`. */
  declared: Declared,
): void {
  const location = useLocation();
  const navigate = useNavigate();
  // The state as of the previous commit — what tells the state→URL direction whether the APP moved the screen; the other effect must not touch it.
  const prev = useRef<RouteState>(state);

  // Taken apart here and rebuilt inside each effect: the caller builds `declared` inline, so an object dependency would re-run both every render.
  const { timeline, turntables, mastering, frozen } = declared;

  // URL → state, on mount and every back/forward. useLayoutEffect, so a deep link draws its screen before paint.
  useLayoutEffect(() => {
    const next = stateForLocation(location.pathname, location.search, state, {
      timeline,
      turntables,
      mastering,
      frozen,
    });
    if (next) apply(next);
    // `state` is deliberately NOT a dependency — this direction reacts to the LOCATION; the declared flags ARE, landing a moment later.

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    location.pathname,
    location.search,
    timeline,
    turntables,
    mastering,
    frozen,
  ]);

  // state → URL.
  useEffect(() => {
    const before = prev.current;
    prev.current = state;
    const url = urlForState(state, before, location.pathname, location.search, {
      timeline,
      turntables,
      mastering,
      frozen,
    });
    if (url === null) return;
    // Entering help pushes so Back leaves it; everything else replaces (see the header).
    navigate(url, { replace: !(state.help && !before.help) });
  }, [
    state,
    navigate,
    location.pathname,
    location.search,
    timeline,
    turntables,
    mastering,
    frozen,
  ]);
}
