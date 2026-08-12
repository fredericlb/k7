// The address a project is opened at. All of it is pure now — the launch used to be read
// once at import and kept in sessionStorage, and this suite could only cover the parsing
// around it; the path IS the state, so the round trip st0 → l8 is testable end to end.

import { describe, expect, it } from "vitest";
import { launchUrl, parseLaunch, projectBasename, projectsUrl } from "./launch";

const L8 = "/l8/";

describe("parseLaunch", () => {
  it("is null when the address names no project", () => {
    expect(parseLaunch("/l8/", "l8", L8)).toBe(null);
    expect(parseLaunch("/l8", "l8", L8)).toBe(null);
  });

  it("is null for an address outside this app's mount", () => {
    // /m9's address is not l8's to read, and neither is a stray path on the origin.
    expect(parseLaunch("/m9/songs/a.m9", "l8", L8)).toBe(null);
    expect(parseLaunch("/projects", "l8", L8)).toBe(null);
  });

  it("reads the repository and the project out of the path", () => {
    expect(parseLaunch("/l8/songs/first.l8", "l8", L8)).toEqual({
      repo: "songs",
      project: "first.l8",
    });
  });

  it("keeps a project that sits at a depth", () => {
    expect(parseLaunch("/l8/band/albums/winter.l8", "l8", L8)).toEqual({
      repo: "band",
      project: "albums/winter.l8",
    });
  });

  it("stops the project at the suffix, so the app's own route can follow", () => {
    // This is what makes the basename work: /timeline belongs to routes.ts, not to the path.
    expect(parseLaunch("/l8/band/winter.l8/timeline", "l8", L8)).toEqual({
      repo: "band",
      project: "winter.l8",
    });
    expect(
      parseLaunch("/l8/band/winter.l8/edit/tracks/a.yaml", "l8", L8),
    ).toEqual({ repo: "band", project: "winter.l8" });
  });

  it("reads each app's OWN suffix, so a nested project belongs to the app that claims it", () => {
    // A `.z0` inside a `.l8` is a real arrangement — see git-repos/src/mirror.ts. It used to be
    // a `.m9` set nested in a song; the suffix went with the app, the rule did not.
    const path = "/z0/editor-v2/band/winter.l8/partie.z0";
    expect(parseLaunch(path, "z0", "/z0/editor-v2/")).toEqual({
      repo: "band",
      project: "winter.l8/partie.z0",
    });
  });

  it("treats a repository with no project folder as the project itself", () => {
    expect(parseLaunch("/l8/lonely", "l8", L8)).toEqual({
      repo: "lonely",
      project: ".",
    });
    // …and the app's route still follows it, because a view never ends in .l8.
    expect(parseLaunch("/l8/lonely/timeline", "l8", L8)).toEqual({
      repo: "lonely",
      project: ".",
    });
  });

  it("unescapes what the link escaped", () => {
    expect(parseLaunch("/l8/my%20band/a%20song.l8", "l8", L8)).toEqual({
      repo: "my band",
      project: "a song.l8",
    });
  });

  it("works when the app is served from a bare origin (the dev port mode)", () => {
    expect(parseLaunch("/band/winter.l8", "l8", "/")).toEqual({
      repo: "band",
      project: "winter.l8",
    });
  });
});

describe("projectBasename", () => {
  it("is the mount plus the project, so the router writes only below it", () => {
    expect(projectBasename("/l8/band/winter.l8/timeline", "l8", L8)).toBe(
      "/l8/band/winter.l8",
    );
  });

  it("re-escapes what it round-trips", () => {
    expect(projectBasename("/l8/my%20band/a%20song.l8", "l8", L8)).toBe(
      "/l8/my%20band/a%20song.l8",
    );
  });

  it("falls back to the mount when the address names no project", () => {
    // The app still mounts; its gate is what sends you to st0.
    expect(projectBasename("/l8/", "l8", L8)).toBe(L8);
  });

  it("stops at the repository when that IS the project", () => {
    expect(projectBasename("/l8/lonely/timeline", "l8", L8)).toBe("/l8/lonely");
  });
});

describe("launchUrl", () => {
  it("names one project in one repository, as a path", () => {
    expect(
      launchUrl("https://st0.priv.frediver.se", "songs", "a/b.l8", "l8"),
    ).toBe("https://st0.priv.frediver.se/l8/songs/a/b.l8");
  });

  it("sends a SET to l8, like every other shape of project", () => {
    // A set had a suffix and an app of its own once. It is an `.l8` with no arrangement, a
    // `songs.yaml` and a `turntables` surface — so there is one link to build, not two.
    expect(
      launchUrl("https://st0.priv.frediver.se", "band", "live.l8", "l8"),
    ).toBe("https://st0.priv.frediver.se/l8/band/live.l8");
  });

  // z0 is seven SPAs behind one prefix, and only one of them opens a project — so its address
  // carries the SPA too (PROJECT_MOUNTS). This is the pair that would silently 404 if the two
  // ends ever disagreed about that segment.
  it("sends a z0 session to the editor, not to the game's apex", () => {
    expect(
      launchUrl(
        "https://st0.priv.frediver.se",
        "lemo_mante",
        "session-2304.z0",
        "z0",
      ),
    ).toBe(
      "https://st0.priv.frediver.se/z0/editor-v2/lemo_mante/session-2304.z0",
    );
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
    expect(parseLaunch(url.pathname, "z0", "/z0/editor-v2/")).toEqual({
      repo: "lemo_mante",
      project: "a/party.z0",
    });
  });

  it("keeps only the origin, whatever URL it is handed", () => {
    expect(
      launchUrl(
        "https://st0.priv.frediver.se/projects/abc",
        "band",
        "a.l8",
        "l8",
      ),
    ).toBe("https://st0.priv.frediver.se/l8/band/a.l8");
  });

  it("escapes a name a path could not otherwise carry", () => {
    expect(
      launchUrl("https://st0.priv.frediver.se", "my band", "a song.l8", "l8"),
    ).toBe("https://st0.priv.frediver.se/l8/my%20band/a%20song.l8");
  });

  // The property that matters: st0 writes these, l8 and m9 read them back.
  it("round-trips through parseLaunch", () => {
    const repo = "lemo mante";
    const project = "songs/a b/c.l8";
    const url = new URL(
      launchUrl("https://st0.priv.frediver.se", repo, project, "l8"),
    );
    expect(parseLaunch(url.pathname, "l8", L8)).toEqual({ repo, project });
  });

  it("round-trips a repository that is itself the project", () => {
    const url = new URL(
      launchUrl("https://st0.priv.frediver.se", "solo", ".", "l8"),
    );
    expect(url.pathname).toBe("/l8/solo");
    expect(parseLaunch(url.pathname, "l8", L8)).toEqual({
      repo: "solo",
      project: ".",
    });
  });
});

describe("projectsUrl", () => {
  it("is st0's Projets section, which answers the origin root", () => {
    expect(projectsUrl("https://st0.priv.frediver.se/l8/band/a.l8")).toBe(
      "https://st0.priv.frediver.se/projects",
    );
  });
});
