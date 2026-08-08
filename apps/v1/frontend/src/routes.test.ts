import { describe, expect, it } from "vitest";
import { fromLocation, sameRoute, toPath } from "./routes";

// The URL <-> screen mapping, both directions, as a pair of pure functions — the hazard the
// hook exists to avoid is a feedback loop between them, so they are tested apart from it.

describe("toPath", () => {
  it("names the view, and the open file when there is one", () => {
    expect(toPath({ view: "cut", file: null })).toBe("/cut");
    expect(toPath({ view: "edit", file: null })).toBe("/edit");
    expect(
      toPath({ view: "edit", file: "film.v1/video_tracks/main.yaml" }),
    ).toBe("/edit/film.v1/video_tracks/main.yaml");
  });

  it("drops a file the view cannot open", () => {
    // Only `edit` shows one, so carrying it on `cut` would put a path in the address that
    // names nothing — and that reads back as a file the editor should have open.
    expect(toPath({ view: "cut", file: "film.v1/project.yaml" })).toBe("/cut");
  });
});

describe("fromLocation", () => {
  it("round-trips every screen", () => {
    for (const s of [
      { view: "cut" as const, file: null },
      { view: "edit" as const, file: null },
      { view: "edit" as const, file: "film.v1/video_tracks/main.yaml" },
    ])
      expect(fromLocation(toPath(s))).toEqual(s);
  });

  it("falls back to the default view on a path it doesn't know", () => {
    // The URL bar is user-editable; a typo should land somewhere usable rather than leaving
    // the app with no screen at all.
    expect(fromLocation("/nonsense")).toEqual({ view: "cut", file: null });
    expect(fromLocation("/")).toEqual({ view: "cut", file: null });
  });

  it("keeps a file path's slashes — it is workspace-relative, not one segment", () => {
    expect(fromLocation("/edit/a/b/c.yaml").file).toBe("a/b/c.yaml");
  });
});

describe("sameRoute", () => {
  it("is true only when the screen is identical", () => {
    expect(
      sameRoute(
        { view: "edit", file: "a.yaml" },
        { view: "edit", file: "a.yaml" },
      ),
    ).toBe(true);
    expect(
      sameRoute(
        { view: "edit", file: "a.yaml" },
        { view: "edit", file: "b.yaml" },
      ),
    ).toBe(false);
    expect(
      sameRoute({ view: "cut", file: null }, { view: "edit", file: null }),
    ).toBe(false);
  });
});
