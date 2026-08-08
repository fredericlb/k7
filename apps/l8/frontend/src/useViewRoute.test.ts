import { describe, expect, it } from "vitest";
import type { RouteState } from "./routes";
import { stateForLocation, urlForState } from "./useViewRoute";

// The two directions are tested as a SEQUENCE, because the bug they encode is one of
// ORDERING. React runs the layout effect (URL → state) and the passive effect
// (state → URL) in the same commit, and the passive one still closes over the state as
// it was BEFORE `apply` — so on a deep link it is handed the OLD screen and the NEW
// address. Read that as "the app moved the screen", and it navigates back to where the
// link came from; the URL→state side then re-applies, and the two push each other back
// and forth for ever. On screen that is a page that blinks and never settles.
//
// `commit` below is the smallest honest model of that: one React commit, effects in the
// order React runs them, with the passive side seeing the pre-apply state.

const GLOBAL: RouteState = {
  view: "global",
  full: null,
  panel: null,
  help: false,
};

/** One commit. Returns the state after it and the URL it wrote (null = none). */
function commit(
  state: RouteState,
  prev: RouteState,
  pathname: string,
  search = "",
): { state: RouteState; prev: RouteState; navigated: string | null } {
  // Layout effect first — it may schedule new state, which this commit does NOT see.
  const next = stateForLocation(pathname, search, state);
  // Passive effect, with the state this commit still holds.
  const navigated = urlForState(state, prev, pathname, search);
  return { state: next ?? state, prev: state, navigated };
}

/** Run commits until the URL and the state stop changing, or give up (a loop). */
function settle(
  state: RouteState,
  pathname: string,
  max = 8,
): { state: RouteState; path: string; commits: number } {
  let s = state;
  let p = state;
  let path = pathname;
  for (let i = 1; i <= max; i++) {
    const r = commit(
      s,
      p,
      path.split("?")[0],
      path.includes("?") ? `?${path.split("?")[1]}` : "",
    );
    const changed =
      r.state !== s || (r.navigated !== null && r.navigated !== path);
    s = r.state;
    p = r.prev;
    if (r.navigated !== null) path = r.navigated;
    if (!changed) return { state: s, path, commits: i };
  }
  throw new Error(`did not settle in ${max} commits — last path ${path}`);
}

describe("a deep link", () => {
  it("opens the screen it names, and stays there", () => {
    // The regression: the app landed on /chains, bounced itself back to /, re-applied
    // /chains, and never stopped.
    const r = settle(GLOBAL, "/chains");
    expect(r.state.full).toBe("chains");
    expect(r.path).toBe("/chains");
  });

  it("writes no history entry of its own", () => {
    // Arriving BY the URL must not write the URL: every one of those is a history entry,
    // and the entry it would add is the one you are already on.
    const first = commit(GLOBAL, GLOBAL, "/chains");
    expect(first.navigated).toBeNull();
    // …and the commit after `apply` lands agrees the address is already right.
    const second = commit(first.state, first.prev, "/chains");
    expect(second.navigated).toBeNull();
  });

  it("carries the side panel with it", () => {
    const r = settle(GLOBAL, "/timeline?panel=mixer");
    expect(r.state.full).toBe("timeline");
    expect(r.state.panel).toBe("mixer");
    expect(r.path).toBe("/timeline?panel=mixer");
  });

  it("settles on every screen the table can name", () => {
    for (const path of [
      "/",
      "/editor",
      "/timeline",
      "/chains",
      "/help",
      "/chains?panel=graph",
      "/help?panel=logs",
    ]) {
      const r = settle(GLOBAL, path);
      expect(r.path, `${path} should settle on itself`).toBe(path);
    }
  });
});

describe("a screen change made by the app", () => {
  it("is written to the URL", () => {
    const moved: RouteState = { ...GLOBAL, full: "chains" };
    expect(urlForState(moved, GLOBAL, "/", "")).toBe("/chains");
  });

  it("writes nothing when the screen didn't actually change", () => {
    expect(urlForState(GLOBAL, GLOBAL, "/", "")).toBeNull();
  });

  it("writes nothing when the address already says so", () => {
    // Back/forward: the location moved first, and the state is following it.
    const moved: RouteState = { ...GLOBAL, full: "chains" };
    expect(urlForState(moved, GLOBAL, "/chains", "")).toBeNull();
  });
});

describe("back and forward", () => {
  it("follows the address without writing it back", () => {
    // On /chains, the user presses Back to "/".
    const onChains: RouteState = { ...GLOBAL, full: "chains" };
    const first = commit(onChains, onChains, "/");
    expect(first.navigated).toBeNull();
    expect(first.state.full).toBeNull();
    const second = commit(first.state, first.prev, "/");
    expect(second.navigated).toBeNull();
  });
});
