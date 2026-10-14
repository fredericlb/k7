// The home page's own verbs. Three things here would be wrong silently: a line landing in
// the WRONG workspace (a project made where nobody was looking), a `project delete confirm`
// that deletes whatever happened to be armed rather than what it names, and a catalogue row
// whose sentence is missing or too long to read — the same rules commandSpec.test.ts holds the
// brain's to, said here for the half that never reaches it.

import type { AccountWorkspace } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import {
  buildHomePalette,
  findProject,
  HOME_COMMANDS,
  type HomeActs,
  homeArgValues,
  resolveWorkspace,
  runHomeCommand,
} from "./homeCommands";
import type { AccountFiles } from "./workspaceOps";

const FILES: AccountFiles = {
  fileBase: "https://m",
  token: "t",
  userEmail: "a@b",
  admin: false,
};

const ws = (name: string, projects: string[] = []): AccountWorkspace => ({
  name,
  isSingleProject: false,
  projects: projects.map((path) => ({ path, app: "k7" })),
});

/** What each act was called with — the whole point of injecting them. */
interface Seen {
  create: unknown[][];
  copy: unknown[][];
  rename: unknown[][];
  remove: unknown[][];
  newWorkspace: unknown[][];
}

function harness(
  over: Partial<{
    workspaces: AccountWorkspace[];
    openWs: string | null;
    fileService: AccountFiles | null;
  }> = {},
) {
  const seen: Seen = {
    create: [],
    copy: [],
    rename: [],
    remove: [],
    newWorkspace: [],
  };
  const said: string[] = [];
  const refused: string[] = [];
  let changes = 0;
  // Annotated rather than cast: the fakes are then CHECKED against the real signatures, which is what makes the claim about the real acts.
  const acts: HomeActs = {
    create: async (m, w, folder, _onStep, shape) => {
      seen.create.push([m, w, folder, shape]);
      return folder;
    },
    copy: async (m, from, path, to, name) => {
      seen.copy.push([m, from, path, to, name]);
      return name;
    },
    rename: async (m, w, path, name) => {
      seen.rename.push([m, w, path, name]);
      return name;
    },
    remove: async (m, w, path) => {
      seen.remove.push([m, w, path]);
    },
    newWorkspace: async (m, workspace) => {
      seen.newWorkspace.push([m, workspace]);
      return { workspace };
    },
  };
  const deps = {
    fileService: over.fileService === undefined ? FILES : over.fileService,
    workspaces: over.workspaces ?? [ws("songs", ["hiver.k7"])],
    openWs: over.openWs ?? null,
    acts,
    say: (t: string) => said.push(t),
    refuse: (t: string) => refused.push(t),
    changed: () => {
      changes += 1;
    },
    armed: { current: null } as {
      current: { workspace: string; path: string } | null;
    },
  };
  return {
    deps,
    seen,
    said,
    refused,
    changes: () => changes,
    run: (line: string) => runHomeCommand(line, deps),
  };
}

describe("the catalogue", () => {
  it("says what every command DOES, in both languages", () => {
    for (const c of HOME_COMMANDS) {
      for (const lang of ["en", "fr"] as const) {
        const s = c.readable[lang];
        expect(s.trim(), c.canonical).not.toBe("");
        // A description that merely echoes the name teaches nothing and matches the same letters.
        expect(s.toLowerCase(), c.canonical).not.toBe(c.canonical);
        expect(s.length, `${c.canonical} (${lang})`).toBeGreaterThan(8);
        // The row is the sentence with the name at the right of it: past 60 it is a truncated row, or a list that wraps into a wall.
        expect(s.length, `${c.canonical} (${lang})`).toBeLessThanOrEqual(60);
      }
    }
  });

  it("tells you what every argument accepts", () => {
    const mute = HOME_COMMANDS.flatMap((c) =>
      c.args
        .filter((a) => !a.hint.trim())
        .map((a) => `${c.canonical} <${a.name}>`),
    );
    expect(mute).toEqual([]);
  });

  it("resolves the sentence once, in the reader's language", () => {
    const fr = buildHomePalette("fr-FR").find(
      (c) => c.canonical === "project new",
    );
    expect(fr?.readable).toMatch(/Créer/);
    expect(
      buildHomePalette("en").find((c) => c.canonical === "project new")
        ?.readable,
    ).toMatch(/Create/);
  });
});

describe("which workspace a project verb lands in", () => {
  it("is the one the address has unfolded", () => {
    const found = resolveWorkspace({
      fileService: FILES,
      workspaces: [ws("a"), ws("b")],
      openWs: "b",
    });
    expect("ws" in found && found.ws.name).toBe("b");
  });

  it("is the only one there is, when there is only one", () => {
    const found = resolveWorkspace({
      fileService: FILES,
      workspaces: [ws("a")],
      openWs: null,
    });
    expect("ws" in found && found.ws.name).toBe("a");
  });

  it("REFUSES rather than guessing between several, and names them", () => {
    const found = resolveWorkspace({
      fileService: FILES,
      workspaces: [ws("a"), ws("b")],
      openWs: null,
    });
    expect("error" in found && found.error).toMatch(/a, b/);
  });
});

describe("naming a project", () => {
  const w = ws("songs", ["hiver.k7", "albums/été.k7"]);
  it("takes the path, the folder, or the stem", () => {
    expect(findProject(w, "albums/été.k7")?.path).toBe("albums/été.k7");
    expect(findProject(w, "été.k7")?.path).toBe("albums/été.k7");
    expect(findProject(w, "hiver")?.path).toBe("hiver.k7");
    expect(findProject(w, "printemps")).toBeNull();
  });
});

describe("what a field offers", () => {
  const ctx = {
    fileService: FILES,
    workspaces: [ws("songs", ["hiver.k7"])],
    openWs: null,
  };
  it("the five archetypes and the projects", () => {
    expect(homeArgValues("project new", 0, ctx)).toEqual([
      "arrangement",
      "mix",
      "video",
      // The two that open on no timeline — packages/song/docs/liveProject.md.
      "live",
      "live-video",
    ]);
    expect(homeArgValues("project delete init", 0, ctx)).toEqual(["hiver.k7"]);
  });
});

describe("project new", () => {
  it("creates the folder with its suffix, in the open workspace", async () => {
    const h = harness({
      workspaces: [ws("songs"), ws("band")],
      openWs: "band",
    });
    expect(await h.run("project new arrangement hiver")).toBe(true);
    expect(h.seen.create).toEqual([[FILES, "band", "hiver.k7", "arrangement"]]);
    expect(h.changes()).toBe(1);
    expect(h.said.join(" ")).toMatch(/band\/hiver\.k7/);
  });

  it("refuses an archetype that is not one, and creates nothing", async () => {
    // `live` used to be the example here, which is exactly why it is not any more.
    const h = harness();
    await h.run("project new podcast hiver");
    expect(h.refused.join(" ")).toMatch(/arrangement, mix, video, live/);
    expect(h.seen.create).toEqual([]);
  });

  it("makes a LIVE one — the archetype with no surface at all", async () => {
    const h = harness({
      workspaces: [ws("songs"), ws("band")],
      openWs: "band",
    });
    expect(await h.run("project new live hiver")).toBe(true);
    expect(h.seen.create).toEqual([[FILES, "band", "hiver.k7", "live"]]);
  });

  it("refuses a name the folder rules refuse", async () => {
    const h = harness();
    await h.run("project new mix a/b");
    expect(h.refused.join(" ")).toMatch(/\//);
    expect(h.seen.create).toEqual([]);
  });

  it("says the file service is not answering rather than failing at the far end", async () => {
    const h = harness({ fileService: null });
    await h.run("project new mix hiver");
    expect(h.refused.join(" ")).toMatch(/file service is not answering/);
    expect(h.seen.create).toEqual([]);
  });
});

describe("project copy", () => {
  const two = () => [ws("songs", ["hiver.k7"]), ws("band")];

  it("copies into the named workspace, keeping the source's name by default", async () => {
    const h = harness({ workspaces: two(), openWs: "songs" });
    expect(await h.run("project copy hiver band")).toBe(true);
    expect(h.seen.copy).toEqual([
      [FILES, "songs", "hiver.k7", "band", "hiver.k7"],
    ]);
    expect(h.said.join(" ")).toMatch(/band\/hiver\.k7/);
    expect(h.changes()).toBe(1);
  });

  it("renames the copy when a name is given, suffix and all", async () => {
    const h = harness({ workspaces: two(), openWs: "songs" });
    await h.run("project copy hiver band printemps");
    expect(h.seen.copy[0]?.[4]).toBe("printemps.k7");
  });

  it("refuses the workspace the project is already in", async () => {
    const h = harness({ workspaces: two(), openWs: "songs" });
    await h.run("project copy hiver songs");
    expect(h.refused.join(" ")).toMatch(/already/);
    expect(h.seen.copy).toEqual([]);
  });

  it("refuses a destination that is itself one project", async () => {
    const solo = { ...ws("solo.k7"), isSingleProject: true };
    const h = harness({
      workspaces: [ws("songs", ["hiver.k7"]), solo],
      openWs: "songs",
    });
    await h.run("project copy hiver solo.k7");
    expect(h.refused.join(" ")).toMatch(/never be listed/);
    expect(h.seen.copy).toEqual([]);
  });

  it("names the projects there are when the source is not one of them", async () => {
    const h = harness({ workspaces: two(), openWs: "songs" });
    await h.run("project copy automne band");
    expect(h.refused.join(" ")).toMatch(/hiver\.k7/);
    expect(h.seen.copy).toEqual([]);
  });

  it("offers the other workspaces, and not the ones a copy would hide in", async () => {
    const solo = { ...ws("solo.k7"), isSingleProject: true };
    const ctx = {
      fileService: FILES,
      workspaces: [ws("songs", ["hiver.k7"]), ws("band"), solo],
      openWs: "songs",
    };
    expect(homeArgValues("project copy", 1, ctx)).toEqual(["band"]);
  });
});

describe("project rename", () => {
  const one = () => [ws("songs", ["hiver.k7"])];

  it("renames in the SAME workspace, and puts the suffix back", async () => {
    const h = harness({ workspaces: one(), openWs: "songs" });
    expect(await h.run("project rename hiver printemps")).toBe(true);
    expect(h.seen.rename).toEqual([
      [FILES, "songs", "hiver.k7", "printemps.k7"],
    ]);
    expect(h.said.join(" ")).toMatch(/hiver\.k7 → printemps\.k7/);
    expect(h.changes()).toBe(1);
  });

  it("takes a name of several words, as the other verbs do", async () => {
    const h = harness({ workspaces: one(), openWs: "songs" });
    await h.run("project rename hiver premier jet");
    expect(h.seen.rename[0]?.[3]).toBe("premier jet.k7");
  });

  it("refuses the name it already has, rather than asking the file service", async () => {
    const h = harness({ workspaces: one(), openWs: "songs" });
    await h.run("project rename hiver hiver");
    expect(h.refused.join(" ")).toMatch(/already/);
    expect(h.seen.rename).toEqual([]);
  });

  it("names the projects there are when the one given is not one", async () => {
    const h = harness({ workspaces: one(), openWs: "songs" });
    await h.run("project rename automne printemps");
    expect(h.refused.join(" ")).toMatch(/hiver\.k7/);
    expect(h.seen.rename).toEqual([]);
  });

  it("refuses a name a folder could not carry, before touching the file service", async () => {
    const h = harness({ workspaces: one(), openWs: "songs" });
    await h.run("project rename hiver a/b");
    expect(h.refused.join(" ")).toMatch(/\//);
    expect(h.seen.rename).toEqual([]);
  });

  it("offers the open workspace's projects for its first field", () => {
    expect(
      homeArgValues("project rename", 0, {
        fileService: FILES,
        workspaces: one(),
        openWs: "songs",
      }),
    ).toEqual(["hiver.k7"]);
  });

  it("says what it needs when told half a line", async () => {
    const h = harness({ workspaces: one(), openWs: "songs" });
    await h.run("project rename hiver");
    expect(h.refused.join(" ")).toMatch(
      /usage: project rename <project> <new name>/,
    );
  });
});

describe("project delete, in two halves", () => {
  it("arms the named project and says what confirming does", async () => {
    const h = harness();
    await h.run("project delete init hiver");
    expect(h.deps.armed.current).toEqual({
      workspace: "songs",
      path: "hiver.k7",
    });
    expect(h.said.join(" ")).toMatch(/project delete confirm hiver\.k7/);
    expect(h.seen.remove).toEqual([]);
  });

  it("deletes when the SAME project is named again", async () => {
    const h = harness();
    await h.run("project delete init hiver");
    await h.run("project delete confirm hiver.k7");
    expect(h.seen.remove).toEqual([[FILES, "songs", "hiver.k7"]]);
  });

  it("refuses a confirm nothing armed", async () => {
    const h = harness();
    await h.run("project delete confirm hiver.k7");
    expect(h.refused.join(" ")).toMatch(/nothing has been named/);
    expect(h.seen.remove).toEqual([]);
  });

  it("refuses a confirm naming ANOTHER project", async () => {
    // Otherwise the second line is a formality, which is the one thing it must not be.
    const h = harness({ workspaces: [ws("songs", ["hiver.k7", "été.k7"])] });
    await h.run("project delete init hiver");
    await h.run("project delete confirm été.k7");
    expect(h.refused.join(" ")).toMatch(/not what was named/);
    expect(h.seen.remove).toEqual([]);
  });

  it("is DISARMED by any command in between", async () => {
    // The same rule the graph's pending insert follows: an armed destructive verb must not sit waiting behind three unrelated lines.
    const h = harness();
    await h.run("project delete init hiver");
    await h.run("system workspace new other");
    await h.run("project delete confirm hiver.k7");
    expect(h.refused.join(" ")).toMatch(/nothing has been named/);
    expect(h.seen.remove).toEqual([]);
  });
});

describe("system workspace new", () => {
  it("makes an EMPTY workspace, and says so", async () => {
    const h = harness();
    await h.run("system workspace new hiver");
    expect(h.seen.newWorkspace).toEqual([[FILES, "hiver"]]);
    // No project: the archetype is asked for by the editor, on the empty workspace.
    expect(h.said.join(" ")).toMatch(/empty/);
  });

  it("strips a suffix somebody typed — a workspace is a plain folder", async () => {
    const h = harness();
    await h.run("system workspace new hiver.k7");
    expect(h.seen.newWorkspace).toEqual([[FILES, "hiver"]]);
  });

  it("refuses a name a folder could not carry, before touching the file service", async () => {
    const h = harness();
    await h.run("system workspace new a/b");
    expect(h.seen.newWorkspace).toEqual([]);
    expect(h.refused.join(" ")).toMatch(/“\/”/);
  });
});

describe("a line this screen does not know", () => {
  it("is not claimed, so the caller can say so once", async () => {
    const h = harness();
    expect(await h.run("track mute gtr")).toBe(false);
    expect(h.refused).toEqual([]);
  });

  it("…and a verb whose name PREFIXES another is read as the longest", async () => {
    const h = harness();
    await h.run("project delete init hiver");
    // Not `project delete` with "init hiver" after it: the arming names the project alone.
    expect(h.deps.armed.current?.path).toBe("hiver.k7");
  });
});
