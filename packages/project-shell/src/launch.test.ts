// The address a project is opened at. The path IS the state, so all of this is pure and the
// round trip — st0's home page writes a link, an editor parses it back — is covered end to
// end, in node, with nothing mounted.

import { describe, expect, it } from "vitest";
import { launchUrl, parseLaunch, projectBasename, projectsUrl } from "./launch";

// st0's mount is the ORIGIN ROOT, so a project is `/<repo>/<project>` with no prefix at all.
const ST0 = "/";

describe("parseLaunch", () => {
  it("is null when the address names no project", () => {
    expect(parseLaunch("/", "st0", ST0)).toBe(null);
    expect(parseLaunch("", "st0", ST0)).toBe(null);
  });

  it("is null for an address outside this app's mount", () => {
    // The EDGE keeps other prefixes away from this reader; z0's editor has one of its own.
    expect(parseLaunch("/rehearsal/sessions", "z0", "/z0/editor/")).toBe(null);
  });

  it("reads a path the edge claims as a repository name, which is exactly right", () => {
    // Stated so nobody 'fixes' it: a stale `/st0/…` bookmark names a repository called `st0`.
    expect(parseLaunch("/st0/band/winter.st0", "st0", ST0)).toEqual({
      repo: "st0",
      project: "band/winter.st0",
    });
  });

  it("reads the repository and the project out of the path", () => {
    expect(parseLaunch("/songs/first.st0", "st0", ST0)).toEqual({
      repo: "songs",
      project: "first.st0",
    });
  });

  it("keeps a project that sits at a depth", () => {
    expect(parseLaunch("/band/albums/winter.st0", "st0", ST0)).toEqual({
      repo: "band",
      project: "albums/winter.st0",
    });
  });

  it("stops the project at the suffix, so the app's own route can follow", () => {
    // This is what makes the basename work: /timeline belongs to routes.ts, not to the path.
    expect(parseLaunch("/band/winter.st0/timeline", "st0", ST0)).toEqual({
      repo: "band",
      project: "winter.st0",
    });
    expect(
      parseLaunch("/band/winter.st0/edit/tracks/a.yaml", "st0", ST0),
    ).toEqual({ repo: "band", project: "winter.st0" });
  });

  it("reads each app's OWN suffix, so a nested project belongs to the app that claims it", () => {
    // A `.z0` inside a `.st0` is a real arrangement: one repository, two apps.
    const path = "/z0/editor/band/winter.st0/partie.z0";
    expect(parseLaunch(path, "z0", "/z0/editor/")).toEqual({
      repo: "band",
      project: "winter.st0/partie.z0",
    });
  });

  it("treats a repository with no project folder as the project itself", () => {
    expect(parseLaunch("/lonely", "st0", ST0)).toEqual({
      repo: "lonely",
      project: ".",
    });
    // …and the app's route still follows it, because a view never ends in .st0.
    expect(parseLaunch("/lonely/timeline", "st0", ST0)).toEqual({
      repo: "lonely",
      project: ".",
    });
  });

  it("unescapes what the link escaped", () => {
    expect(parseLaunch("/my%20band/a%20song.st0", "st0", ST0)).toEqual({
      repo: "my band",
      project: "a song.st0",
    });
  });

  it("works when the app is served from a bare origin (the dev port mode)", () => {
    expect(parseLaunch("/band/winter.st0", "st0", "/")).toEqual({
      repo: "band",
      project: "winter.st0",
    });
  });
});

describe("projectBasename", () => {
  it("is the mount plus the project, so the router writes only below it", () => {
    expect(projectBasename("/band/winter.st0/timeline", "st0", ST0)).toBe(
      "/band/winter.st0",
    );
  });

  it("re-escapes what it round-trips", () => {
    expect(projectBasename("/my%20band/a%20song.st0", "st0", ST0)).toBe(
      "/my%20band/a%20song.st0",
    );
  });

  it("falls back to the mount when the address names no project", () => {
    // The app still mounts either way, and the router needs a basename: it is the mount.
    expect(projectBasename("/", "st0", ST0)).toBe(ST0);
  });

  it("stops at the repository when that IS the project", () => {
    expect(projectBasename("/lonely/timeline", "st0", ST0)).toBe("/lonely");
  });
});

describe("launchUrl", () => {
  it("names one project in one repository, as a path", () => {
    expect(
      launchUrl("https://st0.priv.frediver.se", "songs", "a/b.st0", "st0"),
    ).toBe("https://st0.priv.frediver.se/songs/a/b.st0");
  });

  it("sends a SET to st0, like every other shape of project", () => {
    // A set is an `.st0` like every other shape a project takes, so there is one link.
    expect(
      launchUrl("https://st0.priv.frediver.se", "band", "live.st0", "st0"),
    ).toBe("https://st0.priv.frediver.se/band/live.st0");
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
        "a.st0",
        "st0",
      ),
    ).toBe("https://st0.priv.frediver.se/band/a.st0");
  });

  it("escapes a name a path could not otherwise carry", () => {
    expect(
      launchUrl("https://st0.priv.frediver.se", "my band", "a song.st0", "st0"),
    ).toBe("https://st0.priv.frediver.se/my%20band/a%20song.st0");
  });

  // The property that matters: st0's home page writes these, the apps read them back.
  it("round-trips through parseLaunch", () => {
    const repo = "lemo mante";
    const project = "songs/a b/c.st0";
    const url = new URL(
      launchUrl("https://st0.priv.frediver.se", repo, project, "st0"),
    );
    expect(parseLaunch(url.pathname, "st0", ST0)).toEqual({ repo, project });
  });

  it("round-trips a repository that is itself the project", () => {
    const url = new URL(
      launchUrl("https://st0.priv.frediver.se", "solo", ".", "st0"),
    );
    expect(url.pathname).toBe("/solo");
    expect(parseLaunch(url.pathname, "st0", ST0)).toEqual({
      repo: "solo",
      project: ".",
    });
  });
});

describe("projectsUrl", () => {
  it("is st0's home — its mount with no project after it", () => {
    expect(projectsUrl("https://st0.priv.frediver.se/band/a.st0")).toBe(
      "https://st0.priv.frediver.se/",
    );
  });

  // `parseLaunch` must read it back as "no project", or the home would clone its own first segment.
  it("names no project, which is what makes it the home", () => {
    const home = new URL(
      projectsUrl("https://st0.priv.frediver.se/band/a.st0"),
    );
    expect(parseLaunch(home.pathname, "st0", ST0)).toBe(null);
  });
});
