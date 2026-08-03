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
  it("maps the two layouts and each fullscreen pane", () => {
    expect(toPath(st())).toBe("/");
    expect(toPath(st({ view: "video" }))).toBe("/video");
    expect(toPath(st({ full: "timeline" }))).toBe("/timeline");
    expect(toPath(st({ full: "viewport" }))).toBe("/viewport");
    expect(toPath(st({ help: true }))).toBe("/docs");
  });

  it("drops the layout once a pane is fullscreened", () => {
    // You are looking at the timeline, not at the video layout behind it.
    expect(toPath(st({ view: "video", full: "timeline" }))).toBe("/timeline");
  });

  it("carries the panel as a query on any screen", () => {
    expect(toPath(st({ panel: "mixer" }))).toBe("/?panel=mixer");
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
      st({ view: "video" }),
      st({ full: "editor" }),
      st({ full: "chains", panel: "mixer" }),
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
    // Leaving /timeline should put you back in the video layout you came from, so the
    // path must not force `view` back to global.
    expect(fromLocation("/timeline", "", "video").view).toBe("video");
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
    expect(fromLocation("//video//", "", "global").view).toBe("video");
  });
});

describe("sameRoute", () => {
  it("is true only when the URL would be identical", () => {
    expect(sameRoute(st({ full: "editor" }), st({ full: "editor" }))).toBe(
      true,
    );
    // The layout is not in the URL while a pane is full, so these agree.
    expect(
      sameRoute(
        st({ full: "editor", view: "video" }),
        st({ full: "editor", view: "global" }),
      ),
    ).toBe(true);
    expect(sameRoute(st({ panel: "mixer" }), st({ panel: "logs" }))).toBe(
      false,
    );
  });
});
