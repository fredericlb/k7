import { describe, expect, it } from "vitest";
import { fromLocation, type RouteState, sameRoute, toPath } from "./routes";

const st = (o: Partial<RouteState> = {}): RouteState => ({
  view: "global",
  full: null,
  panel: null,
  help: false,
  surface: null,
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
    // `/docs` is the HELP page and `panel=graph` is a panel — two different things that both
    // used to be spelled "docs" while a Docs panel existed. Only one is left.
    expect(toPath(st({ help: true, panel: "graph" }))).toBe(
      "/docs?panel=graph",
    );
  });

  it("names an open surface", () => {
    expect(toPath(st({ surface: "desk" }))).toBe("/surface/desk");
    expect(toPath(st({ surface: "desk", panel: "logs" }))).toBe(
      "/surface/desk?panel=logs",
    );
  });

  it("stacks help over a surface over a pane", () => {
    // The URL names the TOPMOST screen, because that is the one you are looking at. Getting
    // this order wrong writes an address that restores something else on reload.
    expect(toPath(st({ surface: "desk", full: "timeline" }))).toBe(
      "/surface/desk",
    );
    expect(toPath(st({ help: true, surface: "desk" }))).toBe("/docs");
  });

  it("escapes a surface id that needs it", () => {
    expect(toPath(st({ surface: "a b" }))).toBe("/surface/a%20b");
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
      st({ surface: "desk" }),
      st({ surface: "a b", panel: "graph" }),
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

  it("reads a surface id WITHOUT checking it exists", () => {
    // Deliberate: the project's surfaces arrive a moment after the shell does, so an address
    // that was validated here would parse to "no surface" on every deep link and quietly drop
    // you on the layout. The screen resolves it once the list lands, and says so if there is
    // no such file.
    expect(fromLocation("/surface/desk", "", "global").surface).toBe("desk");
    expect(fromLocation("/surface/nope", "", "global").surface).toBe("nope");
    expect(fromLocation("/surface/a%20b", "", "global").surface).toBe("a b");
  });

  it("is not a surface without an id", () => {
    expect(fromLocation("/surface/", "", "global")).toEqual(st());
    expect(fromLocation("/surface", "", "global")).toEqual(st());
  });

  it("keeps a hand-typed % that is not an escape", () => {
    // Same rule `parseLaunch` follows: keep it rather than throwing on an address someone typed.
    expect(fromLocation("/surface/100%", "", "global").surface).toBe("100%");
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
