import { describe, expect, it } from "vitest";
import {
  DEFAULT_SECTION,
  fileOf,
  fromLocation,
  moduleOf,
  type RouteState,
  SECTION_IDS,
  sameRoute,
  toPath,
} from "./routes";
import { stateForLocation, urlForState } from "./useLibraryRoute";

// The address is what you are looking at: the section, and the file the builder has open.
// Both directions are here because the hazard is the LOOP between them — the app writing the
// URL, the URL writing the app — and a sequence is the only way to catch it.

const st = (p: Partial<RouteState> = {}): RouteState => ({
  section: DEFAULT_SECTION,
  file: null,
  ...p,
});
/** The section you land on with nothing to go on. Named here so the round-trips below read
 *  as "wherever the default is" rather than baking it in twice. */
const songs = (p: Partial<RouteState> = {}): RouteState =>
  st({ section: "songs", ...p });

describe("toPath", () => {
  it("names the section, and the open file when there is one", () => {
    expect(toPath(songs())).toBe("/songs");
    expect(toPath(st({ section: "modules" }))).toBe("/modules");
    expect(
      toPath(st({ section: "modules", file: "audio/reverb/ui.yaml" })),
    ).toBe("/modules/audio/reverb/ui.yaml");
  });
});

describe("fromLocation", () => {
  it("reads a section, with or without a file", () => {
    expect(fromLocation("/modules")).toEqual(st({ section: "modules" }));
    expect(fromLocation("/modules/audio/reverb/ui.yaml")).toEqual(
      st({ section: "modules", file: "audio/reverb/ui.yaml" }),
    );
    // A category folder is just more path — nothing here knows how deep a module sits.
    expect(
      fromLocation("/modules/audio/filter/auto-wah/module.yaml").file,
    ).toBe("audio/filter/auto-wah/module.yaml");
  });

  it("lands on the default section rather than 404ing inside the app", () => {
    // The URL bar is user-editable, and a typo should not be a dead screen. The bare origin
    // is the studio's front door, and what it opens on is your own repositories.
    expect(fromLocation("/")).toEqual(st());
    expect(fromLocation("/")).toEqual(st({ section: "projects" }));
    expect(fromLocation("/nope/deep/path")).toEqual(st());
  });

  it("drops a file under a section that cannot open one", () => {
    // `songs` is a listing; a path under it names nothing the app can show.
    expect(fromLocation("/songs/some/thing.yaml")).toEqual(songs());
  });

  it("round-trips every screen it can produce", () => {
    for (const s of [
      st(),
      songs(),
      st({ section: "modules" }),
      st({ section: "recordings" }),
      st({ section: "projects" }),
      st({ section: "modules", file: "audio/reverb/presets.yaml" }),
      // Under `projects` the second half is a repository id, not a file — same slot,
      // different meaning. See routes.ts.
      st({ section: "projects", file: "3f9a1c2b7e40" }),
      // The cog's engine-status page: a section with no tab, and no file to carry.
      st({ section: "engine" }),
    ])
      expect(fromLocation(toPath(s))).toEqual(s);
  });

  it("opens a repository from the address, so a link to one survives a reload", () => {
    expect(fromLocation("/projects/3f9a1c2b7e40")).toEqual(
      st({ section: "projects", file: "3f9a1c2b7e40" }),
    );
    expect(fromLocation("/projects")).toEqual(st({ section: "projects" }));
  });

  it("keeps the new section clear of the paths Caddy claims above st0", () => {
    // A section named after another service would never reach this app at all — the edge
    // matches `/l8`, `/m9`, `/k7`, `/z0`, `/dev`, `/console` and `/dev-status` first.
    // See docs/routing.md.
    for (const taken of [
      "l8",
      "m9",
      "k7",
      "z0",
      "dev",
      "console",
      "dev-status",
    ])
      expect(SECTION_IDS as readonly string[]).not.toContain(taken);
  });
});

describe("splitting an open file", () => {
  it("gives the module's folder and the file's own name", () => {
    expect(moduleOf("audio/reverb/ui.yaml")).toBe("audio/reverb");
    expect(fileOf("audio/reverb/ui.yaml")).toBe("ui.yaml");
    // A bare name has no module to belong to — nothing opens.
    expect(moduleOf("ui.yaml")).toBeNull();
    expect(moduleOf(null)).toBeNull();
  });
});

// The two effects, as a sequence. Each returns null for "leave it alone", and getting that
// wrong is either a screen that snaps back or a history entry per click.
describe("keeping the two in step", () => {
  it("writes the URL when the APP moved the screen", () => {
    const next = st({ section: "modules" });
    expect(urlForState(next, songs(), "/songs")).toBe("/modules");
  });

  it("writes nothing when the screen did not change", () => {
    expect(urlForState(songs(), songs(), "/songs")).toBeNull();
  });

  it("writes nothing when the URL already says so — the deep-link case", () => {
    // The commit where URL→state fires hands this side the OLD state and the NEW location,
    // which looks exactly like the app having moved away from the address. It hasn't.
    const arriving = st({ section: "modules", file: "audio/reverb/ui.yaml" });
    expect(
      urlForState(arriving, songs(), "/modules/audio/reverb/ui.yaml"),
    ).toBeNull();
  });

  it("applies a location the state does not already show, and only then", () => {
    expect(stateForLocation("/modules", songs())).toEqual(
      st({ section: "modules" }),
    );
    expect(stateForLocation("/songs", songs())).toBeNull();
  });

  it("settles: a move writes the URL, and reading it back changes nothing", () => {
    const before = songs();
    const after = st({ section: "modules", file: "audio/reverb/ui.yaml" });
    const url = urlForState(after, before, toPath(before));
    expect(url).toBe("/modules/audio/reverb/ui.yaml");
    // …and the other direction, run on what was just written, has nothing to do.
    expect(stateForLocation(url as string, after)).toBeNull();
  });
});

describe("sameRoute", () => {
  it("compares both halves", () => {
    expect(sameRoute(st(), st())).toBe(true);
    expect(sameRoute(st(), st({ section: "modules" }))).toBe(false);
    expect(sameRoute(st({ file: "a/b.yaml" }), st({ file: "a/c.yaml" }))).toBe(
      false,
    );
  });
});
