import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BENCH_REPO,
  benchChainPath,
  benchProjectForChain,
  HAS_SCAFFOLD,
  isShare,
  launchUrl,
  PROJECT_SUFFIXES,
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
    // Neither names a folder kind: a `.st0` carries `video_tracks/` and a `viewport` surface,
    // or `songs.yaml` and a `turntables` surface. See @studio/song's PROJECT_SHAPES.
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
    // st0's service path is the empty string — it answers the origin — so its projects have no
    // prefix at all, while z0's editor keeps one. That asymmetry is the table's, not this
    // function's: it concatenates either way.
    expect(launchUrl(o, "band", "winter.st0", "st0")).toBe(
      "https://st0.priv.frediver.se/band/winter.st0",
    );
    expect(launchUrl(o, "band", "partie.z0", "z0")).toBe(
      "https://st0.priv.frediver.se/z0/editor-v2/band/partie.z0",
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
    // This is what an ADDRESS says, and the machine joins it onto two roots — the médiathèque
    // and the workspace. A traversal accepted here would be a folder made outside both.
    expect(benchChainPath("chains/../../etc/passwd.st0")).toBeNull();
    expect(benchChainPath("chains/./x.st0")).toBeNull();
    expect(benchChainPath("chains//x.st0")).toBeNull();
    expect(benchChainPath("chains/..\\x.st0")).toBeNull();
  });
});

/**
 * A SHARED project's address, and the reason it is spelled with the app's own suffix: it makes
 * the token the PROJECT part of an ordinary address, so `parseLaunch` and everything under it
 * need no change at all. These are what pin that.
 */
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

  /**
   * The bug this pins rendered a blank page and nothing else.
   *
   * `encodeURIComponent` escapes `@`, and RFC 3986 does not — it is a `pchar`, legal literally in
   * a path segment, and a browser keeps it that way. So the link said `/@shares/…`, the router
   * was handed a basename of `/%40shares/…`, React Router found that it did not prefix the
   * location and refused to render ANYTHING. The two sentinels this file mints, `@shares` and
   * `@banc`, were the only names it could get wrong.
   */
  it("writes a link with a literal @, and takes a basename off the path unchanged", () => {
    const url = shareUrl("https://studio.frediver.se", TOKEN);
    expect(url).toBe(`https://studio.frediver.se/@shares/${TOKEN}.st0`);
    const path = new URL(url).pathname;
    expect(projectBasename(path, "st0", "/")).toBe(path);
  });

  it("takes the OTHER spelling of the same address just as happily", () => {
    // `%40shares` and `@shares` are one address, and an old bookmark may hold either. The
    // basename is a SLICE of whatever it was handed, so both prefix their own location.
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
    // The address is typed by anyone and then put into a URL, so it is checked here rather
    // than trusted and checked later.
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

  /**
   * The hash the viewer derives, checked against the one pl8 stored — `createHash("sha256")` in
   * `apps/pl8/backend/src/shares/store.ts`. The two are computed by different APIs on different
   * machines and only ever meet as a directory name, so a disagreement would be a 404 on every
   * link ever minted, with nothing anywhere saying why.
   */
  it("hashes a token to the key pl8 named the directory with", async () => {
    const key = await shareKey(TOKEN);
    expect(key).toBe(createHash("sha256").update(TOKEN).digest("hex"));
    // The shape pl8's `isKey` gate demands before any path join.
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    // A different token is a different directory: this is the whole of the protection.
    expect(await shareKey(`${TOKEN}x`)).not.toBe(key);
  });

  it("addresses pl8 under its own prefix, on the one unauthenticated route", async () => {
    // The PAGE the viewer is on is st0's, at the origin root; the route that serves the snapshot
    // is pl8's, under `/pl8`. Only the origin of the page URL survives, and the prefix comes
    // back from SERVICE_PATHS — which is what stopped this returning the bare origin, as it
    // correctly did while the médiathèque answered the root.
    const key = await shareKey(TOKEN);
    expect(shareApiBase(`https://studio.frediver.se/@shares/x.st0`, key)).toBe(
      `https://studio.frediver.se/pl8/api/public/share/${key}`,
    );
    expect(shareApiBase("https://st0.priv.frediver.se", key)).toBe(
      `https://st0.priv.frediver.se/pl8/api/public/share/${key}`,
    );
  });
});
