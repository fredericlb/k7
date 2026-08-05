// useViewRoute.ts — keep the screen (view + open file) and the browser's URL in step, both
// directions. Same shape as l8's useViewRoute and st0's useLibraryRoute, and for the same
// reason: the hazard is a feedback loop between the state and two passive effects, so both
// decisions are pure functions tested as a SEQUENCE rather than logic buried in a component.

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

/**
 * state → URL: the address to write, or null to leave it alone.
 *
 * `prev` is the state as of the previous commit. Two reasons to write nothing: the screen did
 * not change, or the URL already says so — we got here BY the address (a deep link, or Back),
 * and writing it again would add a history entry per move. The second test is what makes a
 * deep link survive; the first cannot see it, because `prev` is about the state alone.
 */
export function urlForState(
  state: RouteState,
  prev: RouteState,
  pathname: string,
): string | null {
  if (sameRoute(state, prev)) return null;
  if (sameRoute(state, fromLocation(pathname))) return null;
  return toPath(state);
}

/** Drive `state` from the URL and back. The caller owns the state; this only decides when
 *  each side should follow the other. Everything replaces: a view you clicked through is not
 *  a place you want to walk back out of one step at a time. */
export function useViewRoute(
  state: RouteState,
  apply: (next: RouteState) => void,
): void {
  const location = useLocation();
  const navigate = useNavigate();
  // The state as of the previous commit. Deliberately NOT touched by the URL→state effect:
  // doing so reads as "the app moved" and is the ping-pong this hook exists to avoid.
  const prev = useRef<RouteState>(state);

  // URL → state, on mount and every back/forward. useLayoutEffect, so a deep link draws its
  // screen before paint.
  useLayoutEffect(() => {
    const next = stateForLocation(location.pathname, state);
    if (next) apply(next);
    // `state` is deliberately NOT a dependency: this direction reacts to the LOCATION, and
    // including it would run it on every screen change too — the other half of the loop.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  }, [location.pathname]);

  // state → URL.
  useEffect(() => {
    const before = prev.current;
    prev.current = state;
    const url = urlForState(state, before, location.pathname);
    if (url !== null) navigate(url, { replace: true });
  }, [state, navigate, location.pathname]);
}
