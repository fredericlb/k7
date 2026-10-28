import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BENCH_PROJECT,
  BENCH_REPO,
  benchChainOf,
  benchProject,
  EXTERNAL_INDEX,
  EXTERNAL_SEGMENT,
  externalIndexUrl,
  externalUrl,
  isBenchProject,
  isDroppableProject,
  isExternalIndex,
  isHomePage,
  isLocal,
  isShare,
  LOCAL_REPO,
  launchUrl,
  localProjectUrl,
  localTarget,
  parseExternal,
  parseLaunch,
  projectApp,
  projectBasename,
  projectLabel,
  SHARE_REPO,
  shareApiBase,
  shareKey,
  shareToken,
  shareUrl,
} from "./projects.ts";

describe("projectApp", () => {
  it("reads the suffix", () => {
    expect(projectApp("mysong.k7")).toBe("k7");
  });

  it("does not know `.v1` or `.m9` — both are shapes of an k7 project", () => {
    // Neither names a folder kind: both are shapes inside `.k7` — see @studio/song's PROJECT_SHAPES.
    expect(projectApp("le clip.v1")).toBe(null);
    expect(projectApp("prise v1.v1")).toBe(null);
    expect(projectApp("myset.m9")).toBe(null);
  });

  it("is null for a folder claiming no app", () => {
    for (const name of ["mysong", "songs", "mysong.k7.bak", "k7", "m9"])
      expect(projectApp(name), name).toBe(null);
  });

  it("refuses a bare suffix — `.k7` is a dotfolder, not a nameless project", () => {
    expect(projectApp(".k7")).toBe(null);
  });

  it("reads a suffix only at the END, never as part of a name", () => {
    expect(projectApp("prise v1")).toBe(null);
    expect(projectApp("prise v1.k7")).toBe("k7");
  });

  it("does not match another service's name", () => {
    // pl8 owns no projects; a folder named for it is just a folder.
    expect(projectApp("show.pl8")).toBe(null);
  });

  it("is case-sensitive, like the folder names it reads", () => {
    expect(projectApp("mysong.K7")).toBe(null);
  });
});

describe("projectLabel", () => {
  it("takes the suffix off, which is what a project is called", () => {
    expect(projectLabel("mysong.k7")).toBe("mysong");
    expect(projectLabel("live set.k7")).toBe("live set");
  });

  it("leaves a name that claims no app alone", () => {
    expect(projectLabel("mysong")).toBe("mysong");
  });

  it("keeps a dot that is part of the name", () => {
    expect(projectLabel("v1.2.k7")).toBe("v1.2");
  });
});

describe("launchUrl", () => {
  it("sends a project to k7's origin", () => {
    const o = "https://st0.priv.frediver.se";
    // k7 answers the origin, so its projects have no prefix.
    expect(launchUrl(o, "band", "winter.k7", "k7")).toBe(
      "https://st0.priv.frediver.se/band/winter.k7",
    );
    expect(launchUrl(o, "band", "le clip.k7", "k7")).toBe(
      "https://st0.priv.frediver.se/band/le%20clip.k7",
    );
  });

  it("keeps only the origin of whatever URL it is handed", () => {
    // Callers pass `window.location.href`, which carries a path of its own.
    expect(
      launchUrl("https://st0.priv.frediver.se/projects?x=1", "b", "c.k7", "k7"),
    ).toBe("https://st0.priv.frediver.se/b/c.k7");
  });
});

// A surface addressed on its own: put BELOW the project, so what is pinned here is that nothing above it changed.
describe("a surface's external address", () => {
  const O = "https://st0.priv.frediver.se";

  it("hangs off the project, and names the surface", () => {
    expect(
      externalUrl(O, { repo: "band", project: "winter.k7" }, "desk", "k7"),
    ).toBe("https://st0.priv.frediver.se/band/winter.k7/@external/desk");
  });

  it("leaves the PROJECT parsing exactly as it was", () => {
    // Why this shape: a route below the project is already the app's, so nothing above it moves.
    const p = "/band/winter.k7/@external/desk";
    expect(parseLaunch(p, "k7", "/")).toEqual({
      repo: "band",
      project: "winter.k7",
    });
    expect(projectBasename(p, "k7", "/")).toBe("/band/winter.k7");
  });

  it("reads the surface back out", () => {
    expect(parseExternal("/band/winter.k7/@external/desk", "k7", "/")).toBe(
      "desk",
    );
    // A project at a depth and one that IS its repository: the segment is found by name, not by counting.
    expect(
      parseExternal("/band/songs/winter.k7/@external/desk", "k7", "/"),
    ).toBe("desk");
    expect(parseExternal("/band/@external/desk", "k7", "/")).toBe("desk");
  });

  it("is null for the editor's own addresses", () => {
    for (const p of [
      "/band/winter.k7",
      "/band/winter.k7/timeline",
      "/band/winter.k7/chains-builder/process/normalize",
    ])
      expect(parseExternal(p, "k7", "/"), p).toBeNull();
  });

  it("is null for a truncated one, rather than 'some surface'", () => {
    expect(parseExternal("/band/winter.k7/@external", "k7", "/")).toBeNull();
    expect(parseExternal("/band/winter.k7/@external/", "k7", "/")).toBeNull();
  });

  it("round-trips a name that needs encoding", () => {
    const url = externalUrl(
      O,
      { repo: "band", project: "winter.k7" },
      "le desk",
      "k7",
    );
    expect(url).toContain("/@external/le%20desk");
    expect(parseExternal(new URL(url).pathname, "k7", "/")).toBe("le desk");
  });

  it("keeps `@` literal, as every other sentinel here does", () => {
    // RFC 3986 allows `@` literally, so encoding it would not match the address on screen.
    expect(
      externalUrl(O, { repo: "band", project: "w.k7" }, "desk", "k7"),
    ).toContain(`/${EXTERNAL_SEGMENT}/`);
    expect(
      externalUrl(O, { repo: "band", project: "w.k7" }, "desk", "k7"),
    ).not.toContain("%40");
  });

  it("is null outside the app's mount", () => {
    // Same gate `parseLaunch` applies: an address that is not this app's names nothing here.
    expect(parseExternal("/pl8/band/w.k7/@external/desk", "k7", "/sub/")).toBe(
      null,
    );
  });
});

describe("the menu of those addresses", () => {
  const O = "https://st0.priv.frediver.se";

  it("sits at the app's mount, with no project in it", () => {
    expect(externalIndexUrl(O, "k7")).toBe(
      "https://st0.priv.frediver.se/external",
    );
    expect(isExternalIndex("/external", "/")).toBe(true);
    expect(isExternalIndex("/external/", "/")).toBe(true);
  });

  it("follows the base it is given", () => {
    expect(isExternalIndex("/sub/external", "/sub/")).toBe(true);
    // …and the same path is NOT the menu for a page mounted elsewhere.
    expect(isExternalIndex("/sub/external", "/")).toBe(false);
  });

  it("is exactly one segment, so nothing under it is mistaken for it", () => {
    for (const p of ["/", "/band", "/band/winter.k7", "/external/winter.k7"])
      expect(isExternalIndex(p, "/"), p).toBe(false);
  });

  it("SHADOWS a repository of that name at its root, and only there", () => {
    // The cost of a plain word instead of an `@` sentinel: `/external` is this page, not that clone.
    expect(isExternalIndex(`/${EXTERNAL_INDEX}`, "/")).toBe(true);
    // Every project INSIDE such a repository is untouched: two segments, so the menu does not claim it.
    expect(parseLaunch("/external/winter.k7", "k7", "/")).toEqual({
      repo: "external",
      project: "winter.k7",
    });
    expect(isExternalIndex("/external/winter.k7", "/")).toBe(false);
  });
});

describe("what a DROP may carry", () => {
  it("takes a self-contained project and nothing else", () => {
    // Both tiers filter on this: the browser before it accepts, the file service before it reads.
    expect(isDroppableProject("Winter Sketch.dawproject")).toBe(true);
    expect(isDroppableProject("WINTER.DAWPROJECT")).toBe(true);
    // A `.als` names its samples by path, so dropped alone it would import a silent project.
    expect(isDroppableProject("winter.als")).toBe(false);
    expect(isDroppableProject("winter.wav")).toBe(false);
    expect(isDroppableProject("dawproject")).toBe(false);
  });
});

describe("the bench's address", () => {
  it("names one project, and it is not a chain of the library", () => {
    expect(isBenchProject(BENCH_PROJECT)).toBe(true);
    // Everything else under `@banc` names nothing: a chain is opened from a project, not here.
    expect(isBenchProject("chains/bass/amp.k7")).toBe(false);
    expect(isBenchProject("modules.k7")).toBe(false);
    expect(isBenchProject("live")).toBe(false);
  });

  it("may carry a library chain in front of the rig, and nothing else", () => {
    expect(benchChainOf(BENCH_PROJECT)).toBeNull();
    expect(benchChainOf(benchProject("vocals/warm"))).toBe("vocals/warm");
    expect(isBenchProject(benchProject("vocals/warm"))).toBe(true);
    // A traversal, an empty segment or a project in the middle is no chain ref.
    expect(benchChainOf(`../x/${BENCH_PROJECT}`)).toBeUndefined();
    expect(benchChainOf(`a//b/${BENCH_PROJECT}`)).toBeUndefined();
    expect(benchChainOf(`song.k7/${BENCH_PROJECT}`)).toBeUndefined();
    expect(benchChainOf(`/${BENCH_PROJECT}`)).toBeUndefined();
    // …and it survives the address k7 builds for it.
    const url = launchUrl(
      "https://studio.example",
      BENCH_REPO,
      benchProject("vocals/warm"),
      "k7",
    );
    const at = parseLaunch(new URL(url).pathname, "k7", "/");
    expect(benchChainOf(at?.project ?? "")).toBe("vocals/warm");
  });

  it("survives the round trip k7's home page makes it take", () => {
    // The bench card builds an address; the file service takes it apart again — apps/k7/backend/docs/media/banc.md.
    const url = launchUrl(
      "https://studio.example",
      BENCH_REPO,
      BENCH_PROJECT,
      "k7",
    );
    const at = parseLaunch(new URL(url).pathname, "k7", "/");
    expect(at?.repo).toBe(BENCH_REPO);
    expect(isBenchProject(at?.project ?? "")).toBe(true);
  });
});

/** A SHARED project's address: the app's suffix makes the token an ordinary project part, and these pin it. */
describe("a shared snapshot's address", () => {
  const TOKEN = "Ck7bQ2mR9xLpN4wZaB1dEf3gH5jK8sT0uV6yW2nA";

  it("is a repository name no git repository can have", () => {
    expect(SHARE_REPO.startsWith("@")).toBe(true);
    expect(isShare(SHARE_REPO)).toBe(true);
    expect(isShare("songs")).toBe(false);
    expect(isShare(BENCH_REPO)).toBe(false);
  });

  it("parses back through the ORDINARY reader, with nothing taught to it", () => {
    const url = shareUrl("https://studio.frediver.se", TOKEN);
    const at = parseLaunch(new URL(url).pathname, "k7", "/");
    expect(at).toEqual({ repo: SHARE_REPO, project: `${TOKEN}.k7` });
    if (!at)
      throw new Error("unreachable — the expect above would have failed");
    expect(isShare(at.repo)).toBe(true);
    expect(shareToken(at.project)).toBe(TOKEN);
  });

  /** The bug this pins rendered a blank page: `/%40shares/…` did not prefix `/@shares/…` — docs/addresses.md. */
  it("writes a link with a literal @, and takes a basename off the path unchanged", () => {
    const url = shareUrl("https://studio.frediver.se", TOKEN);
    expect(url).toBe(`https://studio.frediver.se/@shares/${TOKEN}.k7`);
    const path = new URL(url).pathname;
    expect(projectBasename(path, "k7", "/")).toBe(path);
  });

  it("takes the OTHER spelling of the same address just as happily", () => {
    // An old bookmark may hold either spelling; the basename is a SLICE, so both prefix their own location.
    const escaped = `/%40shares/${TOKEN}.k7`;
    expect(parseLaunch(escaped, "k7", "/")).toEqual({
      repo: SHARE_REPO,
      project: `${TOKEN}.k7`,
    });
    expect(projectBasename(escaped, "k7", "/")).toBe(escaped);
  });

  it("keeps the app's own route BELOW the basename", () => {
    // What the basename is for: everything after the project belongs to routes.ts.
    const path = `/@shares/${TOKEN}.k7/timeline`;
    expect(projectBasename(path, "k7", "/")).toBe(`/@shares/${TOKEN}.k7`);
  });

  it("refuses a project part that is not a token", () => {
    // The address is typed by anyone and then put into a URL, so it is checked here rather than later.
    expect(shareToken("winter.k7")).toBeNull(); // too short to be a secret
    expect(shareToken(`${TOKEN}`)).toBeNull(); // no suffix: not a project at all
    expect(shareToken("../../etc/passwd.k7")).toBeNull();
    expect(shareToken("a/b.k7")).toBeNull();
    expect(shareToken(".k7")).toBeNull();
  });

  it("takes the base64url alphabet, which is what mints a token", () => {
    // `randomBytes(32).toString("base64url")` — letters, digits, `-` and `_`, never `+/=`.
    expect(shareToken(`${"-_".repeat(11)}.k7`)).toBe("-_".repeat(11));
    expect(shareToken(`${"a".repeat(30)}+.k7`)).toBeNull();
    expect(shareToken(`${"a".repeat(30)}=.k7`)).toBeNull();
  });

  /** Two APIs on two machines meeting only as a directory name, so a disagreement would 404 every link ever minted. */
  it("hashes a token to the key pl8 named the directory with", async () => {
    const key = await shareKey(TOKEN);
    expect(key).toBe(createHash("sha256").update(TOKEN).digest("hex"));
    // The shape pl8's `isKey` gate demands before any path join.
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    // A different token is a different directory: this is the whole of the protection.
    expect(await shareKey(`${TOKEN}x`)).not.toBe(key);
  });

  it("addresses the share on the family root, on the one unauthenticated route", async () => {
    // The page and the route are both k7's origin now: serviceUrl gives pl8 the family root.
    const key = await shareKey(TOKEN);
    expect(shareApiBase(`https://app.k7.rocks/@shares/x.k7`, key)).toBe(
      `https://app.k7.rocks/api/public/share/${key}`,
    );
    expect(shareApiBase("https://app.priv.k7.rocks", key)).toBe(
      `https://app.priv.k7.rocks/api/public/share/${key}`,
    );
  });
});

describe("a project in a workspace with no repository", () => {
  const ORIGIN = "https://st0.priv.frediver.se";

  it("reads back through parseLaunch with nothing added to it", () => {
    // `@local` sits where a repository goes, and the project part ends by the ordinary rule, unchanged.
    expect(parseLaunch("/@local/Examples/synth-demo.k7", "k7", "/")).toEqual({
      repo: "@local",
      project: "Examples/synth-demo.k7",
    });
    expect(isLocal("@local")).toBe(true);
    expect(isLocal("songs")).toBe(false);
  });

  it("splits the workspace off the front of what parseLaunch answered", () => {
    expect(localTarget("Examples/synth-demo.k7")).toEqual({
      workspace: "Examples",
      project: "synth-demo.k7",
    });
    // A workspace that IS a project: `.` is what parseLaunch already answers when a repository is one.
    expect(localTarget("hiver.k7")).toEqual({
      workspace: "hiver.k7",
      project: ".",
    });
    expect(localTarget("Examples/albums/hiver.k7")).toEqual({
      workspace: "Examples",
      project: "albums/hiver.k7",
    });
  });

  it("refuses a workspace name that is not one", () => {
    // Checked and not trusted, exactly as shareToken is: it is joined onto the user's root.
    expect(localTarget("../elsewhere/x.k7")).toBe(null);
    expect(localTarget("./x.k7")).toBe(null);
    expect(localTarget("")).toBe(null);
  });

  it("builds the address the row links to, round-tripping its own encoding", () => {
    const url = localProjectUrl(ORIGIN, "mes projets", "hiver.k7", "k7");
    expect(url).toBe(`${ORIGIN}/@local/mes%20projets/hiver.k7`);
    const back = parseLaunch(new URL(url).pathname, "k7", "/");
    expect(back && localTarget(back.project)).toEqual({
      workspace: "mes projets",
      project: "hiver.k7",
    });
  });

  it("puts a single-project workspace's name where the project goes, once", () => {
    // The workspace folder IS the project, so the address names it once and `localTarget` reads back the pair.
    const url = localProjectUrl(ORIGIN, "hiver.k7", ".", "k7");
    expect(url).toBe(`${ORIGIN}/@local/hiver.k7`);
    const back = parseLaunch(new URL(url).pathname, "k7", "/");
    expect(back && localTarget(back.project)).toEqual({
      workspace: "hiver.k7",
      project: ".",
    });
  });

  it("is a sentinel no repository can be mistaken for", () => {
    // Three sentinels, one rule: `@` cannot begin a git short name, so none can collide with a repository.
    for (const sentinel of [LOCAL_REPO, BENCH_REPO, SHARE_REPO])
      expect(sentinel.startsWith("@")).toBe(true);
    expect(new Set([LOCAL_REPO, BENCH_REPO, SHARE_REPO]).size).toBe(3);
  });
});

describe("which addresses are the home's own pages", () => {
  it("finds the home's own pages at the mount", () => {
    expect(isHomePage("/libraries", "/")).toBe(true);
    expect(isHomePage("/settings/", "/")).toBe(true);
    expect(isHomePage("/tasks", "/")).toBe(true);
    expect(isHomePage("/about", "/")).toBe(true);
    expect(isHomePage("/k7/settings", "/k7/")).toBe(true);
    expect(isHomePage("/external", "/")).toBe(false);
    expect(isHomePage("/", "/")).toBe(false);
  });

  it("takes every page BELOW a home page as the home's, `/settings/engine` loaded by its address", () => {
    expect(isHomePage("/settings/engine", "/")).toBe(true);
    expect(isHomePage("/k7/settings/engine", "/k7/")).toBe(true);
    // A bare word opens no workspace any more, so nothing below a reserved one is a project.
    expect(isHomePage("/settings/x.k7", "/")).toBe(true);
    expect(isHomePage("/libraries/anything", "/")).toBe(true);
    // Only the head: a workspace may hold a project of that name.
    expect(isHomePage("/@local/settings/x.k7", "/")).toBe(false);
    expect(isHomePage("/@local/ws/settings", "/")).toBe(false);
  });

  it("takes `media` as a PREFIX, every address below it included", () => {
    expect(isHomePage("/media", "/")).toBe(true);
    expect(isHomePage("/media/songs", "/")).toBe(true);
    expect(isHomePage("/media/songs/Miles/So-What/song.yaml", "/")).toBe(true);
    expect(isHomePage("/k7/media/find", "/k7/")).toBe(true);
    // Only the head: a workspace may hold a project of that name.
    expect(isHomePage("/songs/media", "/")).toBe(false);
  });

  it("takes `rehearsal` as a PREFIX, public pages included", () => {
    expect(isHomePage("/rehearsal", "/")).toBe(true);
    expect(isHomePage("/rehearsal/sessions/abc", "/")).toBe(true);
    expect(isHomePage("/rehearsal/@lemo", "/")).toBe(true);
    expect(isHomePage("/k7/rehearsal/exercises", "/k7/")).toBe(true);
    expect(isHomePage("/songs/rehearsal", "/")).toBe(false);
  });
});
