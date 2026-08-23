import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BENCH_REPO,
  benchChainPath,
  benchProjectForChain,
  EXTERNAL_INDEX,
  EXTERNAL_SEGMENT,
  externalIndexUrl,
  externalUrl,
  HAS_SCAFFOLD,
  isExternalIndex,
  isLocal,
  isShare,
  LOCAL_REPO,
  launchUrl,
  localProjectUrl,
  localTarget,
  PROJECT_SUFFIXES,
  parseExternal,
  parseLaunch,
  projectApp,
  projectBasename,
  projectLabel,
  SCAFFOLDED_APPS,
  SHARE_REPO,
  shareApiBase,
  shareKey,
  shareToken,
  shareUrl,
} from "./projects.ts";

describe("projectApp", () => {
  it("reads the suffix", () => {
    expect(projectApp("mysong.st0")).toBe("st0");
    expect(projectApp("session-2304.z0")).toBe("z0");
  });

  it("does not know `.v1` or `.m9` — both are shapes of an st0 project", () => {
    // Neither names a folder kind: both are shapes inside `.st0` — see @studio/song's PROJECT_SHAPES.
    expect(projectApp("le clip.v1")).toBe(null);
    expect(projectApp("prise v1.v1")).toBe(null);
    expect(projectApp("myset.m9")).toBe(null);
  });

  it("is null for a folder claiming no app", () => {
    for (const name of ["mysong", "songs", "mysong.st0.bak", "st0", "m9"])
      expect(projectApp(name), name).toBe(null);
  });

  it("refuses a bare suffix — `.st0` is a dotfolder, not a nameless project", () => {
    expect(projectApp(".st0")).toBe(null);
    expect(projectApp(".z0")).toBe(null);
  });

  it("reads a suffix only at the END, never as part of a name", () => {
    expect(projectApp("prise v1")).toBe(null);
    expect(projectApp("prise v1.st0")).toBe("st0");
  });

  it("does not match another service's name", () => {
    // k7 owns no projects; a folder named for it is just a folder.
    expect(projectApp("show.k7")).toBe(null);
  });

  it("is case-sensitive, like the folder names it reads", () => {
    expect(projectApp("mysong.ST0")).toBe(null);
  });
});

describe("projectLabel", () => {
  it("takes the suffix off, which is what a project is called", () => {
    expect(projectLabel("mysong.st0")).toBe("mysong");
    expect(projectLabel("live set.st0")).toBe("live set");
  });

  it("leaves a name that claims no app alone", () => {
    expect(projectLabel("mysong")).toBe("mysong");
  });

  it("keeps a dot that is part of the name", () => {
    expect(projectLabel("v1.2.st0")).toBe("v1.2");
  });
});

describe("launchUrl", () => {
  it("sends each app to its own service, under one origin", () => {
    const o = "https://st0.priv.frediver.se";
    // st0 answers the origin so its projects have no prefix; the asymmetry is the table's, not this function's.
    expect(launchUrl(o, "band", "winter.st0", "st0")).toBe(
      "https://st0.priv.frediver.se/band/winter.st0",
    );
    expect(launchUrl(o, "band", "partie.z0", "z0")).toBe(
      "https://st0.priv.frediver.se/z0/editor/band/partie.z0",
    );
    expect(launchUrl(o, "band", "le clip.st0", "st0")).toBe(
      "https://st0.priv.frediver.se/band/le%20clip.st0",
    );
  });

  it("keeps only the origin of whatever URL it is handed", () => {
    // Callers pass `window.location.href`, which carries a path of its own.
    expect(
      launchUrl(
        "https://st0.priv.frediver.se/projects?x=1",
        "b",
        "c.st0",
        "st0",
      ),
    ).toBe("https://st0.priv.frediver.se/b/c.st0");
  });
});

// A surface addressed on its own: put BELOW the project, so what is pinned here is that nothing above it changed.
describe("a surface's external address", () => {
  const O = "https://st0.priv.frediver.se";

  it("hangs off the project, and names the surface", () => {
    expect(
      externalUrl(O, { repo: "band", project: "winter.st0" }, "desk", "st0"),
    ).toBe("https://st0.priv.frediver.se/band/winter.st0/@external/desk");
  });

  it("leaves the PROJECT parsing exactly as it was", () => {
    // Why this shape: a route below the project is already the app's, so nothing above it moves.
    const p = "/band/winter.st0/@external/desk";
    expect(parseLaunch(p, "st0", "/")).toEqual({
      repo: "band",
      project: "winter.st0",
    });
    expect(projectBasename(p, "st0", "/")).toBe("/band/winter.st0");
  });

  it("reads the surface back out", () => {
    expect(parseExternal("/band/winter.st0/@external/desk", "st0", "/")).toBe(
      "desk",
    );
    // A project at a depth and one that IS its repository: the segment is found by name, not by counting.
    expect(
      parseExternal("/band/songs/winter.st0/@external/desk", "st0", "/"),
    ).toBe("desk");
    expect(parseExternal("/band/@external/desk", "st0", "/")).toBe("desk");
  });

  it("is null for the editor's own addresses", () => {
    for (const p of [
      "/band/winter.st0",
      "/band/winter.st0/timeline",
      "/band/winter.st0/chains-builder/process/normalize",
    ])
      expect(parseExternal(p, "st0", "/"), p).toBeNull();
  });

  it("is null for a truncated one, rather than 'some surface'", () => {
    expect(parseExternal("/band/winter.st0/@external", "st0", "/")).toBeNull();
    expect(parseExternal("/band/winter.st0/@external/", "st0", "/")).toBeNull();
  });

  it("round-trips a name that needs encoding", () => {
    const url = externalUrl(
      O,
      { repo: "band", project: "winter.st0" },
      "le desk",
      "st0",
    );
    expect(url).toContain("/@external/le%20desk");
    expect(parseExternal(new URL(url).pathname, "st0", "/")).toBe("le desk");
  });

  it("keeps `@` literal, as every other sentinel here does", () => {
    // RFC 3986 allows `@` literally, so encoding it would not match the address on screen.
    expect(
      externalUrl(O, { repo: "band", project: "w.st0" }, "desk", "st0"),
    ).toContain(`/${EXTERNAL_SEGMENT}/`);
    expect(
      externalUrl(O, { repo: "band", project: "w.st0" }, "desk", "st0"),
    ).not.toContain("%40");
  });

  it("is null outside the app's mount", () => {
    // Same gate `parseLaunch` applies: an address that is not this app's names nothing here.
    expect(parseExternal("/pl8/band/w.st0/@external/desk", "st0", "/z0/")).toBe(
      null,
    );
  });
});

describe("the menu of those addresses", () => {
  const O = "https://st0.priv.frediver.se";

  it("sits at the app's mount, with no project in it", () => {
    expect(externalIndexUrl(O, "st0")).toBe(
      "https://st0.priv.frediver.se/external",
    );
    expect(isExternalIndex("/external", "/")).toBe(true);
    expect(isExternalIndex("/external/", "/")).toBe(true);
  });

  it("follows the mount for an app that has one", () => {
    expect(externalIndexUrl(O, "z0")).toBe(
      "https://st0.priv.frediver.se/z0/editor/external",
    );
    expect(isExternalIndex("/z0/editor/external", "/z0/editor/")).toBe(true);
    // …and the same path is NOT the menu for an app mounted elsewhere.
    expect(isExternalIndex("/z0/editor/external", "/")).toBe(false);
  });

  it("is exactly one segment, so nothing under it is mistaken for it", () => {
    for (const p of ["/", "/band", "/band/winter.st0", "/external/winter.st0"])
      expect(isExternalIndex(p, "/"), p).toBe(false);
  });

  it("SHADOWS a repository of that name at its root, and only there", () => {
    // The cost of a plain word instead of an `@` sentinel: `/external` is this page, not that clone.
    expect(isExternalIndex(`/${EXTERNAL_INDEX}`, "/")).toBe(true);
    // Every project INSIDE such a repository is untouched: two segments, so the menu does not claim it.
    expect(parseLaunch("/external/winter.st0", "st0", "/")).toEqual({
      repo: "external",
      project: "winter.st0",
    });
    expect(isExternalIndex("/external/winter.st0", "/")).toBe(false);
  });
});

describe("which apps can be CREATED", () => {
  it("is not the same set as the apps that own a folder kind", () => {
    // z0 owns `.z0` and has no scaffold. Offering it built a `.z0` holding an st0 song.
    expect(SCAFFOLDED_APPS).toEqual(["st0"]);
    expect(HAS_SCAFFOLD.z0).toBe(false);
  });

  it("answers for every app that owns a suffix", () => {
    // The Record is what makes a new ProjectApp fail to compile until someone decides.
    for (const app of Object.keys(PROJECT_SUFFIXES))
      expect(HAS_SCAFFOLD, app).toHaveProperty(app);
  });
});

describe("a chain opened on the bench", () => {
  it("is the catalogue path, and comes back as one", () => {
    const chain = "chains/blindtest/assourdissant/music";
    expect(benchProjectForChain(chain)).toBe(`${chain}.st0`);
    expect(benchChainPath(`${chain}.st0`)).toBe(chain);
  });

  it("is not the module bench, and the module bench is not one", () => {
    expect(benchChainPath("modules.st0")).toBeNull();
    expect(benchChainPath("chains.st0")).toBeNull(); // the family folder itself names no chain
  });

  it("refuses a path that would climb out of the médiathèque", () => {
    // The machine joins this onto two roots, so a traversal accepted here would make a folder outside both.
    expect(benchChainPath("chains/../../etc/passwd.st0")).toBeNull();
    expect(benchChainPath("chains/./x.st0")).toBeNull();
    expect(benchChainPath("chains//x.st0")).toBeNull();
    expect(benchChainPath("chains/..\\x.st0")).toBeNull();
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
    const at = parseLaunch(new URL(url).pathname, "st0", "/");
    expect(at).toEqual({ repo: SHARE_REPO, project: `${TOKEN}.st0` });
    if (!at)
      throw new Error("unreachable — the expect above would have failed");
    expect(isShare(at.repo)).toBe(true);
    expect(shareToken(at.project)).toBe(TOKEN);
  });

  /** The bug this pins rendered a blank page: `/%40shares/…` did not prefix `/@shares/…` — docs/addresses.md. */
  it("writes a link with a literal @, and takes a basename off the path unchanged", () => {
    const url = shareUrl("https://studio.frediver.se", TOKEN);
    expect(url).toBe(`https://studio.frediver.se/@shares/${TOKEN}.st0`);
    const path = new URL(url).pathname;
    expect(projectBasename(path, "st0", "/")).toBe(path);
  });

  it("takes the OTHER spelling of the same address just as happily", () => {
    // An old bookmark may hold either spelling; the basename is a SLICE, so both prefix their own location.
    const escaped = `/%40shares/${TOKEN}.st0`;
    expect(parseLaunch(escaped, "st0", "/")).toEqual({
      repo: SHARE_REPO,
      project: `${TOKEN}.st0`,
    });
    expect(projectBasename(escaped, "st0", "/")).toBe(escaped);
  });

  it("keeps the app's own route BELOW the basename", () => {
    // What the basename is for: everything after the project belongs to routes.ts.
    const path = `/@shares/${TOKEN}.st0/timeline`;
    expect(projectBasename(path, "st0", "/")).toBe(`/@shares/${TOKEN}.st0`);
  });

  it("refuses a project part that is not a token", () => {
    // The address is typed by anyone and then put into a URL, so it is checked here rather than later.
    expect(shareToken("winter.st0")).toBeNull(); // too short to be a secret
    expect(shareToken(`${TOKEN}`)).toBeNull(); // no suffix: not a project at all
    expect(shareToken("../../etc/passwd.st0")).toBeNull();
    expect(shareToken("a/b.st0")).toBeNull();
    expect(shareToken(".st0")).toBeNull();
  });

  it("takes the base64url alphabet, which is what mints a token", () => {
    // `randomBytes(32).toString("base64url")` — letters, digits, `-` and `_`, never `+/=`.
    expect(shareToken(`${"-_".repeat(11)}.st0`)).toBe("-_".repeat(11));
    expect(shareToken(`${"a".repeat(30)}+.st0`)).toBeNull();
    expect(shareToken(`${"a".repeat(30)}=.st0`)).toBeNull();
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

  it("addresses pl8 under its own prefix, on the one unauthenticated route", async () => {
    // The page is st0's at the root, the route is pl8's under `/pl8`: the prefix comes back from SERVICE_PATHS.
    const key = await shareKey(TOKEN);
    expect(shareApiBase(`https://studio.frediver.se/@shares/x.st0`, key)).toBe(
      `https://studio.frediver.se/pl8/api/public/share/${key}`,
    );
    expect(shareApiBase("https://st0.priv.frediver.se", key)).toBe(
      `https://st0.priv.frediver.se/pl8/api/public/share/${key}`,
    );
  });
});

describe("a project in a workspace with no repository", () => {
  const ORIGIN = "https://st0.priv.frediver.se";

  it("reads back through parseLaunch with nothing added to it", () => {
    // `@local` sits where a repository goes, and the project part ends by the ordinary rule, unchanged.
    expect(parseLaunch("/@local/Examples/synth-demo.st0", "st0", "/")).toEqual({
      repo: "@local",
      project: "Examples/synth-demo.st0",
    });
    expect(isLocal("@local")).toBe(true);
    expect(isLocal("songs")).toBe(false);
  });

  it("splits the workspace off the front of what parseLaunch answered", () => {
    expect(localTarget("Examples/synth-demo.st0")).toEqual({
      workspace: "Examples",
      project: "synth-demo.st0",
    });
    // A workspace that IS a project: `.` is what parseLaunch already answers when a repository is one.
    expect(localTarget("hiver.st0")).toEqual({
      workspace: "hiver.st0",
      project: ".",
    });
    expect(localTarget("Examples/albums/hiver.st0")).toEqual({
      workspace: "Examples",
      project: "albums/hiver.st0",
    });
  });

  it("refuses a workspace name that is not one", () => {
    // Checked and not trusted, exactly as benchChainPath and shareToken are: it is joined onto the user's root.
    expect(localTarget("../elsewhere/x.st0")).toBe(null);
    expect(localTarget("./x.st0")).toBe(null);
    expect(localTarget("")).toBe(null);
  });

  it("builds the address the row links to, round-tripping its own encoding", () => {
    const url = localProjectUrl(ORIGIN, "mes projets", "hiver.st0", "st0");
    expect(url).toBe(`${ORIGIN}/@local/mes%20projets/hiver.st0`);
    const back = parseLaunch(new URL(url).pathname, "st0", "/");
    expect(back && localTarget(back.project)).toEqual({
      workspace: "mes projets",
      project: "hiver.st0",
    });
  });

  it("puts a single-project workspace's name where the project goes, once", () => {
    // The workspace folder IS the project, so the address names it once and `localTarget` reads back the pair.
    const url = localProjectUrl(ORIGIN, "hiver.st0", ".", "st0");
    expect(url).toBe(`${ORIGIN}/@local/hiver.st0`);
    const back = parseLaunch(new URL(url).pathname, "st0", "/");
    expect(back && localTarget(back.project)).toEqual({
      workspace: "hiver.st0",
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
