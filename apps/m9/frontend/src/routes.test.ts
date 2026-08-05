import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEW,
  fromLocation,
  type RouteState,
  sameRoute,
  toPath,
} from "./routes";
import { stateForLocation, urlForState } from "./useViewRoute";

// The address is which view you are on, and the file the editor has open. Both directions are
// here because the hazard is the LOOP between them — the app writing the URL, the URL writing
// the app — and a sequence is the only way to catch it.

const st = (p: Partial<RouteState> = {}): RouteState => ({
  view: DEFAULT_VIEW,
  file: null,
  ...p,
});

describe("toPath", () => {
  it("names the view, and the open file when the view can carry one", () => {
    expect(toPath(st())).toBe("/mix");
    expect(toPath(st({ view: "graph" }))).toBe("/graph");
    expect(toPath(st({ view: "edit", file: "tracks/bass.yaml" }))).toBe(
      "/edit/tracks/bass.yaml",
    );
    // A file held over from the editor does not follow you into another view's address.
    expect(toPath(st({ view: "graph", file: "tracks/bass.yaml" }))).toBe(
      "/graph",
    );
  });
});

describe("fromLocation", () => {
  it("reads a view, with or without a file", () => {
    expect(fromLocation("/graph")).toEqual(st({ view: "graph" }));
    expect(fromLocation("/edit/tracks/bass.yaml")).toEqual(
      st({ view: "edit", file: "tracks/bass.yaml" }),
    );
    // A nested path is just more path — nothing here knows how deep a file sits.
    expect(fromLocation("/edit/modules/audio/reverb/module.yaml").file).toBe(
      "modules/audio/reverb/module.yaml",
    );
  });

  it("lands on the default view rather than 404ing inside the app", () => {
    expect(fromLocation("/")).toEqual(st());
    expect(fromLocation("/nope/deep/path")).toEqual(st());
  });

  it("drops a file under a view that cannot open one", () => {
    expect(fromLocation("/mix/some/thing.yaml")).toEqual(st());
  });

  it("round-trips every screen it can produce", () => {
    for (const s of [
      st(),
      st({ view: "edit" }),
      st({ view: "graph" }),
      st({ view: "edit", file: "chains.yaml" }),
    ])
      expect(fromLocation(toPath(s))).toEqual(s);
  });
});

// The two effects, as a sequence. Each returns null for "leave it alone", and getting that
// wrong is either a screen that snaps back or a history entry per click.
describe("keeping the two in step", () => {
  it("writes the URL when the APP moved the screen", () => {
    expect(urlForState(st({ view: "graph" }), st(), "/mix")).toBe("/graph");
  });

  it("writes nothing when the screen did not change", () => {
    expect(urlForState(st(), st(), "/mix")).toBeNull();
  });

  it("writes nothing when the URL already says so — the deep-link case", () => {
    // The commit where URL→state fires hands this side the OLD state and the NEW location,
    // which looks exactly like the app having moved away from the address. It hasn't.
    const arriving = st({ view: "edit", file: "chains.yaml" });
    expect(urlForState(arriving, st(), "/edit/chains.yaml")).toBeNull();
  });

  it("applies a location the state does not already show, and only then", () => {
    expect(stateForLocation("/graph", st())).toEqual(st({ view: "graph" }));
    expect(stateForLocation("/mix", st())).toBeNull();
  });

  it("settles: a move writes the URL, and reading it back changes nothing", () => {
    const before = st();
    const after = st({ view: "edit", file: "chains.yaml" });
    const url = urlForState(after, before, toPath(before));
    expect(url).toBe("/edit/chains.yaml");
    expect(stateForLocation(url as string, after)).toBeNull();
  });
});

describe("sameRoute", () => {
  it("compares both halves", () => {
    expect(sameRoute(st(), st())).toBe(true);
    expect(sameRoute(st(), st({ view: "graph" }))).toBe(false);
    expect(sameRoute(st({ file: "a.yaml" }), st({ file: "b.yaml" }))).toBe(
      false,
    );
  });
});
