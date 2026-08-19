// The address a project is opened at. All of it is pure now — the launch used to be read
// once at import and kept in sessionStorage, and this suite could only cover the parsing
// around it; the path IS the state, so the round trip pl8 → l8 is testable end to end.

import { describe, expect, it } from "vitest";
import { launchUrl, parseLaunch, projectBasename, projectsUrl } from "./launch";

// l8's mount: the ORIGIN ROOT, since the editor became the studio's front door and the
// médiathèque moved to `/pl8`. A project is therefore `/<dépôt>/<projet>` with no prefix at all,
// which is what most of this suite is about.
const L8 = "/";

describe("parseLaunch", () => {
  it("is null when the address names no project", () => {
    expect(parseLaunch("/", "l8", L8)).toBe(null);
    expect(parseLaunch("", "l8", L8)).toBe(null);
  });

  it("is null for an address outside this app's mount", () => {
    // An app mounted under a prefix has addresses that are not its own; l8's mount is the
    // origin itself, so the only address outside it is the empty one above. What keeps
    // `/pl8/…`, `/k7/…` and `/z0/…` away from this reader is the EDGE, which never sends them
    // here — see apps/studio/docker/nginx.conf. z0's editor still has a prefix and is the case
    // this branch is exercised by.
    expect(parseLaunch("/k7/sessions", "z0", "/z0/editor-v2/")).toBe(null);
  });

  it("reads a path the edge claims as a repository name, which is exactly right", () => {
    // The consequence of l8 answering the root, stated so nobody 'fixes' it: the first segment
    // IS the repository, so a stale `/l8/band/winter.l8` bookmark now names a repository called
    // `l8`. That resolves to nothing and the gate says so by name — a legible failure, and the
    // reason the edge's prefix list doubles as a list of unusable repository names.
    expect(parseLaunch("/l8/band/winter.l8", "l8", L8)).toEqual({
      repo: "l8",
      project: "band/winter.l8",
    });
  });

  it("reads the repository and the project out of the path", () => {
    expect(parseLaunch("/songs/first.l8", "l8", L8)).toEqual({
      repo: "songs",
      project: "first.l8",
    });
  });

  it("keeps a project that sits at a depth", () => {
    expect(parseLaunch("/band/albums/winter.l8", "l8", L8)).toEqual({
      repo: "band",
      project: "albums/winter.l8",
    });
  });

  it("stops the project at the suffix, so the app's own route can follow", () => {
    // This is what makes the basename work: /timeline belongs to routes.ts, not to the path.
    expect(parseLaunch("/band/winter.l8/timeline", "l8", L8)).toEqual({
      repo: "band",
      project: "winter.l8",
    });
    expect(parseLaunch("/band/winter.l8/edit/tracks/a.yaml", "l8", L8)).toEqual(
      { repo: "band", project: "winter.l8" },
    );
  });

  it("reads each app's OWN suffix, so a nested project belongs to the app that claims it", () => {
    // A `.z0` inside a `.l8` is a real arrangement — see git-repos/src/mirror.ts.
    const path = "/z0/editor-v2/band/winter.l8/partie.z0";
    expect(parseLaunch(path, "z0", "/z0/editor-v2/")).toEqual({
      repo: "band",
      project: "winter.l8/partie.z0",
    });
  });

  it("treats a repository with no project folder as the project itself", () => {
    expect(parseLaunch("/lonely", "l8", L8)).toEqual({
      repo: "lonely",
      project: ".",
    });
    // …and the app's route still follows it, because a view never ends in .l8.
    expect(parseLaunch("/lonely/timeline", "l8", L8)).toEqual({
      repo: "lonely",
      project: ".",
    });
  });

  it("unescapes what the link escaped", () => {
    expect(parseLaunch("/my%20band/a%20song.l8", "l8", L8)).toEqual({
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
    expect(projectBasename("/band/winter.l8/timeline", "l8", L8)).toBe(
      "/band/winter.l8",
    );
  });

  it("re-escapes what it round-trips", () => {
    expect(projectBasename("/my%20band/a%20song.l8", "l8", L8)).toBe(
      "/my%20band/a%20song.l8",
    );
  });

  it("falls back to the mount when the address names no project", () => {
    // The app still mounts — for l8 that address IS the home page, and for anything else the
    // gate redirects there. Either way the router needs a basename, and it is the mount.
    expect(projectBasename("/", "l8", L8)).toBe(L8);
  });

  it("stops at the repository when that IS the project", () => {
    expect(projectBasename("/lonely/timeline", "l8", L8)).toBe("/lonely");
  });
});

describe("launchUrl", () => {
  it("names one project in one repository, as a path", () => {
    expect(
      launchUrl("https://st0.priv.frediver.se", "songs", "a/b.l8", "l8"),
    ).toBe("https://st0.priv.frediver.se/songs/a/b.l8");
  });

  it("sends a SET to l8, like every other shape of project", () => {
    // A set had a suffix and an app of its own once. It is an `.l8` with no arrangement, a
    // `songs.yaml` and a `turntables` surface — so there is one link to build, not two.
    expect(
      launchUrl("https://st0.priv.frediver.se", "band", "live.l8", "l8"),
    ).toBe("https://st0.priv.frediver.se/band/live.l8");
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
    ).toBe("https://st0.priv.frediver.se/band/a.l8");
  });

  it("escapes a name a path could not otherwise carry", () => {
    expect(
      launchUrl("https://st0.priv.frediver.se", "my band", "a song.l8", "l8"),
    ).toBe("https://st0.priv.frediver.se/my%20band/a%20song.l8");
  });

  // The property that matters: pl8 writes these, the apps read them back.
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
    expect(url.pathname).toBe("/solo");
    expect(parseLaunch(url.pathname, "l8", L8)).toEqual({
      repo: "solo",
      project: ".",
    });
  });
});

describe("projectsUrl", () => {
  it("is l8's home — its mount with no project after it", () => {
    expect(projectsUrl("https://st0.priv.frediver.se/band/a.l8")).toBe(
      "https://st0.priv.frediver.se/",
    );
  });

  // The whole point of the address it answers: `parseLaunch` must read it back as "no project",
  // or the home would resolve its own first segment as a repository and clone something.
  it("names no project, which is what makes it the home", () => {
    const home = new URL(projectsUrl("https://st0.priv.frediver.se/band/a.l8"));
    expect(parseLaunch(home.pathname, "l8", L8)).toBe(null);
  });
});
