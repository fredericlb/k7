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
    // opens on the catalogue's first family — the repositories are l8's home page now.
    expect(fromLocation("/")).toEqual(st());
    expect(fromLocation("/")).toEqual(st({ section: "songs" }));
    expect(fromLocation("/nope/deep/path")).toEqual(st());
  });

  it("no longer knows the repositories, which moved to l8's home", () => {
    // Not a section any more, so it is an unknown first segment like any other typo — and a
    // bookmark on the old address lands somewhere usable rather than on a blank screen.
    // See apps/l8/frontend/docs/projects.md.
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
    // The tags become path segments through `segment()`, which keeps spaces, parentheses and
    // `&` — all legal in a folder name and all things the browser encodes on its way into the
    // URL bar. Read back raw, "Back%20in%20Black" matches no entry and the screen opens on
    // nothing, so the two directions have to encode and decode symmetrically.
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
    // A hand-typed escape that decodes to nothing valid is left as it stands rather than
    // throwing: it names no entry, which is exactly what a typo in the URL bar should do.
    expect(fromLocation("/songs/%zz/song.yaml").file).toBe("%zz/song.yaml");
  });

  it("opens a song and a chain from the address, like a module", () => {
    // The regression this guards is not the deep link but the LOOP: a section that opens an
    // editor and cannot read its own address writes a URL, reads back the bare section, and
    // shuts the editor a tick later. `chains` did exactly that until `songs` joined it.
    expect(
      fromLocation("/songs/AC-DC/Back in Black/Hells Bells/song.yaml"),
    ).toEqual(songs({ file: "AC-DC/Back in Black/Hells Bells/song.yaml" }));
    expect(fromLocation("/chains/blindtest/sans-voix/chains.yaml")).toEqual(
      st({ section: "chains", file: "blindtest/sans-voix/chains.yaml" }),
    );
  });

  it("opens a playlist, whose file is the whole of the second half", () => {
    // One segment where a song has four: the file IS the entry, so there is no folder in
    // front of it. `folderOf` therefore answers null here, and nothing asks it to.
    expect(fromLocation("/playlists/ete-2026.yaml")).toEqual(
      st({ section: "playlists", file: "ete-2026.yaml" }),
    );
    expect(fromLocation("/playlists/live/repet.yaml")).toEqual(
      st({ section: "playlists", file: "live/repet.yaml" }),
    );
    expect(folderOf("ete-2026.yaml")).toBeNull();
  });

  it("round-trips every screen it can produce", () => {
    for (const s of [
      st(),
      songs(),
      st({ section: "modules" }),
      st({ section: "recordings" }),
      st({ section: "modules", file: "audio/reverb/presets.yaml" }),
      songs({ file: "AC-DC/Back in Black/Hells Bells/song.yaml" }),
      st({ section: "chains", file: "blindtest/sans-voix/chains.yaml" }),
      // A playlist's file IS its entry, so the second half is one segment shorter than the
      // three above — no folder to pair it with. See packages/mediatek/docs/playlists.md.
      st({ section: "playlists", file: "ete-2026.yaml" }),
      st({ section: "playlists", file: "live/repet du jeudi.yaml" }),
      // The cog's engine-status page: a section with no tab, and no file to carry.
      st({ section: "engine" }),
      // « Trouver des morceaux », the other tabless one — a PAGE rather than a dialogue,
      // because its history grows. See ../../docs/hunt.md.
      st({ section: "find" }),
    ])
      expect(fromLocation(toPath(s))).toEqual(s);
  });

  it("garde une adresse pour la recherche de morceaux, donc rechargeable", () => {
    // Ce que le dialogue ne pouvait pas offrir : une page qu'on recharge, qu'on met en
    // signet, et dont le bouton « précédent » ramène aux morceaux.
    expect(fromLocation("/find")).toEqual({ section: "find", file: null });
    // Rien à porter en seconde moitié : la page n'ouvre pas un élément, elle EST l'écran.
    expect(fromLocation("/find/whatever")).toEqual({
      section: "find",
      file: null,
    });
  });

  it("keeps the new section clear of the paths the proxy claims above st0", () => {
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
