// useLibraryRoute.ts — keep the screen (section + open file) and the browser's URL in step,
// both directions. Same shape as l8' useViewRoute, and for the same reason: the hazard is
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

/**
 * state → URL: the address to write, or null to leave it alone.
 *
 * `prev` is the state as of the previous commit. Two reasons to write nothing:
 *
 *   the screen did not change  — nothing happened; this effect just re-ran.
 *   the URL already says so    — we got here BY the URL (deep link, back/forward), so
 *                                writing it again would add a history entry per move.
 *
 * The second test is what makes a deep link survive. In the commit where the URL→state
 * direction fires, this side is handed the OLD state and the NEW location, which looks
 * exactly like "the app moved the screen away from the address". It isn't, and the only
 * honest way to tell is to ask whether the address already agrees with where we are going —
 * which the first test cannot see, because `prev` is about the state alone.
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

/**
 * Drive `state` from the URL and back. The caller owns the state; this only decides when each
 * side should follow the other.
 *
 * Opening a FILE pushes, so Back closes the builder rather than leaving the app; changing
 * section replaces, because a tab you clicked through is not a place you want to walk back
 * out of one step at a time.
 */
export function useLibraryRoute(
  state: RouteState,
  apply: (next: RouteState) => void,
): void {
  const location = useLocation();
  const navigate = useNavigate();
  // The state as of the previous commit — what tells the state→URL direction whether the APP
  // moved the screen. Deliberately NOT touched by the URL→state effect: doing so reads as
  // "the app moved" and is the ping-pong this hook exists to avoid.
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
    if (url === null) return;
    navigate(url, { replace: !(state.file && !before.file) });
  }, [state, navigate, location.pathname]);
}
