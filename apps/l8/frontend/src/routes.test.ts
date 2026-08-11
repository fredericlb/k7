import { describe, expect, it } from "vitest";
import { fromLocation, type RouteState, sameRoute, toPath } from "./routes";

const st = (o: Partial<RouteState> = {}): RouteState => ({
  view: "global",
  full: null,
  panel: null,
  help: false,
  ...o,
});

describe("toPath", () => {
  it("maps the layout and each fullscreen pane", () => {
    expect(toPath(st())).toBe("/");
    expect(toPath(st({ full: "timeline" }))).toBe("/timeline");
    expect(toPath(st({ full: "chains" }))).toBe("/chains");
    expect(toPath(st({ help: true }))).toBe("/docs");
  });

  it("drops the layout once a pane is fullscreened", () => {
    // You are looking at the timeline, not at the layout behind it.
    expect(toPath(st({ full: "timeline" }))).toBe("/timeline");
  });

  it("carries the panel as a query on any screen", () => {
    expect(toPath(st({ panel: "graph" }))).toBe("/?panel=graph");
    expect(toPath(st({ full: "chains", panel: "logs" }))).toBe(
      "/chains?panel=logs",
    );
    expect(toPath(st({ help: true, panel: "docs" }))).toBe("/docs?panel=docs");
  });
});

describe("fromLocation", () => {
  it("round-trips every screen", () => {
    for (const s of [
      st(),
      st({ full: "editor" }),
      st({ full: "chains", panel: "graph" }),
      st({ help: true }),
      st({ panel: "logs" }),
    ]) {
      const path = toPath(s);
      const [pathname, search] = path.split("?");
      expect(
        fromLocation(pathname, search ? `?${search}` : "", s.view),
      ).toEqual(s);
    }
  });

  it("keeps the current layout under a fullscreen pane", () => {
    // The path must not force `view`: with one layout that is invisible, and the rule is the
    // routing's rather than the layout list's — a second layout would rely on it again.
    expect(fromLocation("/timeline", "", "global").view).toBe("global");
  });

  it("falls back to the global view on a path it doesn't know", () => {
    // The URL bar is user-editable; a typo should land somewhere usable rather than
    // leaving the shell with no screen at all.
    expect(fromLocation("/nonsense", "", "global")).toEqual(st());
    expect(fromLocation("/", "", "global")).toEqual(st());
  });

  it("ignores a panel it doesn't know", () => {
    expect(fromLocation("/", "?panel=wat", "global").panel).toBeNull();
  });

  it("tolerates trailing and doubled slashes", () => {
    expect(fromLocation("/timeline/", "", "global").full).toBe("timeline");
    // `/video` was a real address until picture left for v1; it still lands somewhere usable.
    expect(fromLocation("//video//", "", "global")).toEqual(st());
  });
});

describe("sameRoute", () => {
  it("is true only when the URL would be identical", () => {
    expect(sameRoute(st({ full: "editor" }), st({ full: "editor" }))).toBe(
      true,
    );
    expect(sameRoute(st({ panel: "graph" }), st({ panel: "logs" }))).toBe(
      false,
    );
  });
});
