import { describe, expect, it } from "vitest";
import {
  DEFAULT_SECTION,
  fileOf,
  folderOf,
  fromLocation,
  type RouteState,
  SECTION_IDS,
  sameRoute,
  toPath,
} from "./routes";
import { stateForLocation, urlForState } from "./useLibraryRoute";

// Both directions are here because the hazard is the LOOP between them (../docs/routing.md).

const st = (p: Partial<RouteState> = {}): RouteState => ({
  section: DEFAULT_SECTION,
  file: null,
  ...p,
});
/** The section you land on with nothing to go on, named so a round-trip reads "wherever the default is". */
const songs = (p: Partial<RouteState> = {}): RouteState =>
  st({ section: "songs", ...p });

describe("toPath", () => {
  it("names the section, and the open file when there is one", () => {
    expect(toPath(songs())).toBe("/songs");
    expect(toPath(st({ section: "samples" }))).toBe("/samples");
    expect(
      toPath(st({ section: "songs", file: "Miles/So-What/song.yaml" })),
    ).toBe("/songs/Miles/So-What/song.yaml");
  });
});

describe("fromLocation", () => {
  it("reads a section, with or without a file", () => {
    expect(fromLocation("/samples")).toEqual(st({ section: "samples" }));
    expect(fromLocation("/songs/Miles/So-What/song.yaml")).toEqual(
      st({ section: "songs", file: "Miles/So-What/song.yaml" }),
    );
    // A deep folder is just more path — nothing here knows how deep a song sits.
    expect(
      fromLocation("/songs/AC-DC/Back-in-Black/Hells-Bells/song.yaml").file,
    ).toBe("AC-DC/Back-in-Black/Hells-Bells/song.yaml");
  });

  it("lands on the default section rather than 404ing inside the app", () => {
    // The URL bar is user-editable, and a typo should not be a dead screen.
    expect(fromLocation("/")).toEqual(st());
    expect(fromLocation("/")).toEqual(st({ section: "songs" }));
    expect(fromLocation("/nope/deep/path")).toEqual(st());
  });

  it("no longer knows the repositories, which moved to st0's home", () => {
    // An unknown first segment like any other typo — see apps/st0/frontend/docs/projects.md.
    expect(fromLocation("/projects")).toEqual(st());
    expect(fromLocation("/projects/3f9a1c2b7e40")).toEqual(st());
  });

  it("drops a file under a section that cannot open one", () => {
    // `samples` and `recordings` are listings; a path under one names nothing the app can show.
    expect(fromLocation("/samples/kicks/909.wav")).toEqual(
      st({ section: "samples" }),
    );
    expect(fromLocation("/recordings/2026-08-05/take.wav")).toEqual(
      st({ section: "recordings" }),
    );
  });

  it("survives a song folder named like a song", () => {
    // The tags become path segments, so the two directions have to encode and decode symmetrically.
    const s = songs({ file: "AC-DC/Back in Black/Hells Bells/song.yaml" });
    expect(toPath(s)).toBe(
      "/songs/AC-DC/Back%20in%20Black/Hells%20Bells/song.yaml",
    );
    expect(fromLocation(toPath(s))).toEqual(s);
    // …and the shapes that are not spaces: an ampersand, and a title in parentheses.
    for (const file of [
      "Simon & Garfunkel/Bookends/America/song.yaml",
      "Nirvana/Unplugged/The Man Who Sold The World (Live)/song.yaml",
    ])
      expect(fromLocation(toPath(songs({ file })))).toEqual(songs({ file }));
    // A hand-typed escape that decodes to nothing valid is left as it stands rather than throwing.
    expect(fromLocation("/songs/%zz/song.yaml").file).toBe("%zz/song.yaml");
  });

  it("opens a song from the address", () => {
    // What this guards is the LOOP rather than the deep link — see ../docs/routing.md.
    expect(
      fromLocation("/songs/AC-DC/Back in Black/Hells Bells/song.yaml"),
    ).toEqual(songs({ file: "AC-DC/Back in Black/Hells Bells/song.yaml" }));
    // A section that carries nothing drops what follows it rather than 404ing inside the app.
    expect(fromLocation("/playlists/ete-2026.yaml")).toEqual(st());
    // A lone file name has no folder in front of it, which is the null `folderOf` answers.
    expect(folderOf("ete-2026.yaml")).toBeNull();
  });

  it("round-trips every screen it can produce", () => {
    for (const s of [
      st(),
      songs(),
      st({ section: "samples" }),
      st({ section: "recordings" }),
      songs({ file: "Miles/Kind-of-Blue/So-What/song.yaml" }),
      songs({ file: "AC-DC/Back in Black/Hells Bells/song.yaml" }),
      // The cog's engine-status page: a section with no tab, and no file to carry.
      st({ section: "engine" }),
      // « Trouver des morceaux », the other tabless one — a PAGE, since its history grows.
      st({ section: "find" }),
    ])
      expect(fromLocation(toPath(s))).toEqual(s);
  });

  it("garde une adresse pour la recherche de morceaux, donc rechargeable", () => {
    // What the dialog could not offer: a page that reloads, bookmarks and answers the back button.
    expect(fromLocation("/find")).toEqual({ section: "find", file: null });
    // Nothing to carry in the second half: the page opens no item, it IS the screen.
    expect(fromLocation("/find/whatever")).toEqual({
      section: "find",
      file: null,
    });
  });

  it("keeps the new section clear of the paths the proxy claims on the origin", () => {
    // Free rather than load-bearing under `/pl8`, and asserted anyway — see ../docs/routing.md.
    for (const taken of [
      "st0",
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
  it("gives the entry's folder and the file's own name", () => {
    expect(folderOf("audio/reverb/ui.yaml")).toBe("audio/reverb");
    expect(fileOf("audio/reverb/ui.yaml")).toBe("ui.yaml");
    // A song's three tags are just more path, the way a module's category is.
    expect(folderOf("AC-DC/Back in Black/Hells Bells/song.yaml")).toBe(
      "AC-DC/Back in Black/Hells Bells",
    );
    // A bare name has no entry to belong to — nothing opens.
    expect(folderOf("ui.yaml")).toBeNull();
    expect(folderOf(null)).toBeNull();
  });
});

// The two effects as a SEQUENCE: each returns null for "leave it alone" (../docs/routing.md).
describe("keeping the two in step", () => {
  it("writes the URL when the APP moved the screen", () => {
    const next = st({ section: "samples" });
    expect(urlForState(next, songs(), "/songs")).toBe("/samples");
  });

  it("writes nothing when the screen did not change", () => {
    expect(urlForState(songs(), songs(), "/songs")).toBeNull();
  });

  it("writes nothing when the URL already says so — the deep-link case", () => {
    // That commit hands this side the OLD state and the NEW location, which looks like a move.
    const arriving = st({ section: "songs", file: "Miles/So-What/song.yaml" });
    expect(
      urlForState(arriving, songs(), "/songs/Miles/So-What/song.yaml"),
    ).toBeNull();
  });

  it("applies a location the state does not already show, and only then", () => {
    expect(stateForLocation("/samples", songs())).toEqual(
      st({ section: "samples" }),
    );
    expect(stateForLocation("/songs", songs())).toBeNull();
  });

  it("settles: a move writes the URL, and reading it back changes nothing", () => {
    const before = songs();
    const after = st({ section: "songs", file: "Miles/So-What/song.yaml" });
    const url = urlForState(after, before, toPath(before));
    expect(url).toBe("/songs/Miles/So-What/song.yaml");
    // …and the other direction, run on what was just written, has nothing to do.
    expect(stateForLocation(url as string, after)).toBeNull();
  });
});

describe("sameRoute", () => {
  it("compares both halves", () => {
    expect(sameRoute(st(), st())).toBe(true);
    expect(sameRoute(st(), st({ section: "samples" }))).toBe(false);
    expect(sameRoute(st({ file: "a/b.yaml" }), st({ file: "a/c.yaml" }))).toBe(
      false,
    );
  });
});
