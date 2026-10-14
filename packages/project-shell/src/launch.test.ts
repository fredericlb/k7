// The address a project is opened at. The path IS the state, so all of this is pure and the
// round trip — k7's home page writes a link, an editor parses it back — is covered end to
// end, in node, with nothing mounted.

import { describe, expect, it } from "vitest";
import { launchUrl, parseLaunch, projectBasename, projectsUrl } from "./launch";

// k7's mount is the ORIGIN ROOT, so a project is `/<repo>/<project>` with no prefix at all.
const K7 = "/";

describe("parseLaunch", () => {
  it("is null when the address names no project", () => {
    expect(parseLaunch("/", "k7", K7)).toBe(null);
    expect(parseLaunch("", "k7", K7)).toBe(null);
  });

  it("is null for an address outside this app's mount", () => {
    // The EDGE keeps other prefixes away from this reader; z0's editor has one of its own.
    expect(parseLaunch("/rehearsal/sessions", "z0", "/z0/editor/")).toBe(null);
  });

  it("reads a path the edge claims as a repository name, which is exactly right", () => {
    // Stated so nobody 'fixes' it: a stale `/k7/…` bookmark names a repository called `k7`.
    expect(parseLaunch("/k7/band/winter.k7", "k7", K7)).toEqual({
      repo: "k7",
      project: "band/winter.k7",
    });
  });

  it("reads the repository and the project out of the path", () => {
    expect(parseLaunch("/songs/first.k7", "k7", K7)).toEqual({
      repo: "songs",
      project: "first.k7",
    });
  });

  it("keeps a project that sits at a depth", () => {
    expect(parseLaunch("/band/albums/winter.k7", "k7", K7)).toEqual({
      repo: "band",
      project: "albums/winter.k7",
    });
  });

  it("stops the project at the suffix, so the app's own route can follow", () => {
    // This is what makes the basename work: /timeline belongs to routes.ts, not to the path.
    expect(parseLaunch("/band/winter.k7/timeline", "k7", K7)).toEqual({
      repo: "band",
      project: "winter.k7",
    });
    expect(parseLaunch("/band/winter.k7/edit/tracks/a.yaml", "k7", K7)).toEqual(
      { repo: "band", project: "winter.k7" },
    );
  });

  it("reads each app's OWN suffix, so a nested project belongs to the app that claims it", () => {
    // A `.z0` inside a `.k7` is a real arrangement: one repository, two apps.
    const path = "/z0/editor/band/winter.k7/partie.z0";
    expect(parseLaunch(path, "z0", "/z0/editor/")).toEqual({
      repo: "band",
      project: "winter.k7/partie.z0",
    });
  });

  it("treats a repository with no project folder as the project itself", () => {
    expect(parseLaunch("/lonely", "k7", K7)).toEqual({
      repo: "lonely",
      project: ".",
    });
    // …and the app's route still follows it, because a view never ends in .k7.
    expect(parseLaunch("/lonely/timeline", "k7", K7)).toEqual({
      repo: "lonely",
      project: ".",
    });
  });

  it("unescapes what the link escaped", () => {
    expect(parseLaunch("/my%20band/a%20song.k7", "k7", K7)).toEqual({
      repo: "my band",
      project: "a song.k7",
    });
  });

  it("works when the app is served from a bare origin (the dev port mode)", () => {
    expect(parseLaunch("/band/winter.k7", "k7", "/")).toEqual({
      repo: "band",
      project: "winter.k7",
    });
  });
});

describe("projectBasename", () => {
  it("is the mount plus the project, so the router writes only below it", () => {
    expect(projectBasename("/band/winter.k7/timeline", "k7", K7)).toBe(
      "/band/winter.k7",
    );
  });

  it("re-escapes what it round-trips", () => {
    expect(projectBasename("/my%20band/a%20song.k7", "k7", K7)).toBe(
      "/my%20band/a%20song.k7",
    );
  });

  it("falls back to the mount when the address names no project", () => {
    // The app still mounts either way, and the router needs a basename: it is the mount.
    expect(projectBasename("/", "k7", K7)).toBe(K7);
  });

  it("stops at the repository when that IS the project", () => {
    expect(projectBasename("/lonely/timeline", "k7", K7)).toBe("/lonely");
  });
});

describe("launchUrl", () => {
  it("names one project in one repository, as a path", () => {
    expect(
      launchUrl("https://st0.priv.frediver.se", "songs", "a/b.k7", "k7"),
    ).toBe("https://st0.priv.frediver.se/songs/a/b.k7");
  });

  it("sends a SET to k7, like every other shape of project", () => {
    // A set is an `.k7` like every other shape a project takes, so there is one link.
    expect(
      launchUrl("https://st0.priv.frediver.se", "band", "live.k7", "k7"),
    ).toBe("https://st0.priv.frediver.se/band/live.k7");
  });

  // z0's address carries the SPA too (PROJECT_MOUNTS), and this pair would 404 if the ends drifted.
  it("sends a z0 session to the editor, not to the game's apex", () => {
    expect(
      launchUrl(
        "https://st0.priv.frediver.se",
        "lemo_mante",
        "session-2304.z0",
        "z0",
      ),
    ).toBe("https://st0.priv.frediver.se/z0/editor/lemo_mante/session-2304.z0");
  });

  it("round-trips a z0 session through the editor's own base", () => {
    const url = new URL(
      launchUrl(
        "https://st0.priv.frediver.se",
        "lemo_mante",
        "a/party.z0",
        "z0",
      ),
    );
    expect(parseLaunch(url.pathname, "z0", "/z0/editor/")).toEqual({
      repo: "lemo_mante",
      project: "a/party.z0",
    });
  });

  it("keeps only the origin, whatever URL it is handed", () => {
    expect(
      launchUrl(
        "https://st0.priv.frediver.se/projects/abc",
        "band",
        "a.k7",
        "k7",
      ),
    ).toBe("https://st0.priv.frediver.se/band/a.k7");
  });

  it("escapes a name a path could not otherwise carry", () => {
    expect(
      launchUrl("https://st0.priv.frediver.se", "my band", "a song.k7", "k7"),
    ).toBe("https://st0.priv.frediver.se/my%20band/a%20song.k7");
  });

  // The property that matters: k7's home page writes these, the apps read them back.
  it("round-trips through parseLaunch", () => {
    const repo = "lemo mante";
    const project = "songs/a b/c.k7";
    const url = new URL(
      launchUrl("https://st0.priv.frediver.se", repo, project, "k7"),
    );
    expect(parseLaunch(url.pathname, "k7", K7)).toEqual({ repo, project });
  });

  it("round-trips a repository that is itself the project", () => {
    const url = new URL(
      launchUrl("https://st0.priv.frediver.se", "solo", ".", "k7"),
    );
    expect(url.pathname).toBe("/solo");
    expect(parseLaunch(url.pathname, "k7", K7)).toEqual({
      repo: "solo",
      project: ".",
    });
  });
});

describe("projectsUrl", () => {
  it("is k7's home — its mount with no project after it", () => {
    expect(projectsUrl("https://st0.priv.frediver.se/band/a.k7")).toBe(
      "https://st0.priv.frediver.se/",
    );
  });

  // `parseLaunch` must read it back as "no project", or the home would clone its own first segment.
  it("names no project, which is what makes it the home", () => {
    const home = new URL(projectsUrl("https://st0.priv.frediver.se/band/a.k7"));
    expect(parseLaunch(home.pathname, "k7", K7)).toBe(null);
  });
});
