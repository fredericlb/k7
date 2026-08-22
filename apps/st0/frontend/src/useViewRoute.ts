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

/**
 * URL → state: the screen the address names, or null when the state already shows it.
 *
 * `declared` is what the PROJECT says it draws — not part of `RouteState`, since it is a fact
 * about the project rather than about the screen, but the parse needs it: `/timeline` names no
 * pane in a project that declares none, and `/turntables` none in a song that is not a set. See
 * `viewPanes` in routes.ts.
 */
export function stateForLocation(
  pathname: string,
  search: string,
  state: RouteState,
  declared: Declared = {},
): RouteState | null {
  const next = fromLocation(pathname, search, declared);
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
 * The second test is what makes a deep link survive: in the commit where the URL→state
 * direction fires, this side is handed the OLD state and the NEW location, which looks
 * exactly like "the app moved the screen away from the address". It isn't — and the only
 * honest way to tell is to ask whether the address already agrees with where we are
 * going, which the first test cannot see because `prev` is about the state alone.
 */
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
  return toPath(state);
}

/**
 * Drive `state` from the URL and back. The caller owns the state; this only decides when
 * each side should follow the other.
 */
export function useViewRoute(
  state: RouteState,
  apply: (next: RouteState) => void,
  /** What the open project declares, plus whether this is a snapshot — see `stateForLocation`. */
  declared: Declared,
): void {
  const location = useLocation();
  const navigate = useNavigate();
  // The state as of the previous commit — what tells the state→URL direction whether the APP moved the screen.
  // Deliberately NOT touched by the URL→state effect: doing so read as "the app moved" and caused the ping-pong.
  const prev = useRef<RouteState>(state);

  // Taken apart here and put back together INSIDE each effect, rather than closed over as an
  // object: the caller builds it inline, so a new identity every render would re-run both
  // effects every render. Passing the primitives is also what lets the dependency lists be
  // honest — a dependency on `declared` would be a dependency on that identity.
  const { timeline, viewport, turntables, frozen } = declared;

  // URL → state, on mount and every back/forward. useLayoutEffect, so a deep link draws its screen before paint.
  useLayoutEffect(() => {
    const next = stateForLocation(location.pathname, location.search, state, {
      timeline,
      viewport,
      turntables,
      frozen,
    });
    if (next) apply(next);
    // `state` is deliberately NOT a dependency: this direction reacts to the LOCATION, and including it
    // would run it on every screen change too — the other half of the loop described in the header.
    // The declared flags ARE: the surfaces land a moment after the shell, and a `/timeline`,
    // `/viewport` or `/turntables` deep link has to be re-read once the project has said whether
    // it has one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    location.pathname,
    location.search,
    timeline,
    viewport,
    turntables,
    frozen,
  ]);

  // state → URL.
  useEffect(() => {
    const before = prev.current;
    prev.current = state;
    const url = urlForState(state, before, location.pathname, location.search, {
      timeline,
      viewport,
      turntables,
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
    viewport,
    turntables,
    frozen,
  ]);
}
