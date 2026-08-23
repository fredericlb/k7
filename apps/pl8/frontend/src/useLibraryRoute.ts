// useLibraryRoute.ts — keep the screen (section + open file) and the browser's URL in step,
// both directions. Same shape as st0' useViewRoute, and for the same reason: the hazard is
// a feedback loop between the state and two passive effects, so both decisions are pure
// functions tested as a SEQUENCE rather than logic buried in the component.

import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { fromLocation, type RouteState, sameRoute, toPath } from "./routes";

/** URL → state: the screen the address names, or null when the state already shows it. */
export function stateForLocation(
  pathname: string,
  state: RouteState,
): RouteState | null {
  const next = fromLocation(pathname);
  return sameRoute(next, state) ? null : next;
}

/** state → URL: the address to write, or null for either of two reasons (../docs/routing.md). */
export function urlForState(
  state: RouteState,
  prev: RouteState,
  pathname: string,
): string | null {
  if (sameRoute(state, prev)) return null;
  if (sameRoute(state, fromLocation(pathname))) return null;
  return toPath(state);
}

/** Drive `state` from the URL and back — a FILE pushes, a section replaces (../docs/routing.md). */
export function useLibraryRoute(
  state: RouteState,
  apply: (next: RouteState) => void,
): void {
  const location = useLocation();
  const navigate = useNavigate();
  // The previous commit's state, deliberately NOT touched by the URL→state effect.
  const prev = useRef<RouteState>(state);

  // URL → state, in a layout effect so a deep link draws its screen before paint.
  useLayoutEffect(() => {
    const next = stateForLocation(location.pathname, state);
    if (next) apply(next);
    // biome-ignore lint/correctness/useExhaustiveDependencies: this direction reacts to the LOCATION, so `state` is not a dependency
  }, [location.pathname]);

  // state → URL.
  useEffect(() => {
    const before = prev.current;
    prev.current = state;
    const url = urlForState(state, before, location.pathname);
    if (url === null) return;
    navigate(url, { replace: !(state.file && !before.file) });
  }, [state, navigate, location.pathname]);
}
