// The home page's own verbs. Three things here would be wrong silently: a line landing in
// the WRONG repository (a commit pushed where nobody was looking), a `project delete confirm`
// that deletes whatever happened to be armed rather than what it names, and a catalogue row
// whose sentence is missing or too long to read — the same rules commandSpec.test.ts holds the
// brain's to, said here for the half that never reaches it.

import type { MachineWorkspace, RepoSummary } from "@studio/web-protocol";
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
import type { Machine } from "./machine";

const MACHINE: Machine = {
  fileBase: "https://m",
  token: "t",
  userEmail: "a@b",
};

const ws = (
  name: string,
  projects: string[] = [],
  repoName: string | null = name,
): MachineWorkspace => ({
  name,
  origin: null,
  repoName,
  uniqueName: true,
  isSingleProject: false,
  projects: projects.map((path) => ({ path, app: "st0" })),
});

const repo = (name: string): RepoSummary => ({
  id: `id-${name}`,
  uri: `git@h:u/${name}.git`,
  name,
  label: name,
  addedAt: "2026-01-01",
});

/** What each act was called with — the whole point of injecting them. */
interface Seen {
  create: unknown[][];
  copy: unknown[][];
  remove: unknown[][];
  clone: unknown[][];
  newWorkspace: unknown[][];
  publish: unknown[][];
  addRepo: string[];
  forgetRepo: string[];
  command: { workspace: string; line: string }[];
}

function harness(
  over: Partial<{
    workspaces: MachineWorkspace[];
    repos: RepoSummary[];
    openWs: string | null;
    machine: Machine | null;
    gripe: string | null;
  }> = {},
) {
  const seen: Seen = {
    create: [],
    copy: [],
    remove: [],
    clone: [],
    newWorkspace: [],
    publish: [],
    addRepo: [],
    forgetRepo: [],
    command: [],
  };
  const said: string[] = [];
  const refused: string[] = [];
  let changes = 0;
  const gripe = over.gripe ?? null;
  // Annotated rather than cast: the fakes are then CHECKED against the real signatures, which is what makes the claim about the real acts.
  const acts: HomeActs = {
    create: async (m, w, folder, _onStep, shape) => {
      seen.create.push([m, w, folder, shape]);
      return { project: folder, gripe };
    },
    copy: async (m, from, path, to, name, _onStep, noRemote) => {
      seen.copy.push([m, from, path, to, name, noRemote]);
      return { project: name, gripe };
    },
    remove: async (m, w, path) => {
      seen.remove.push([m, w, path]);
      return { gripe };
    },
    clone: async (_m, uri) => {
      seen.clone.push([uri]);
      return "cloned-ws";
    },
    newWorkspace: async (m, workspace) => {
      seen.newWorkspace.push([m, workspace]);
      return { workspace };
    },
    publish: async (m, workspace, uri, _onStep, register) => {
      seen.publish.push([m, workspace, uri]);
      // The real one registers through pl8; the fake takes the same road so the call is seen.
      await register(uri);
      return { registered: true };
    },
    addRepo: async (uri: string) => {
      seen.addRepo.push(uri);
    },
    forgetRepo: async (id: string) => {
      seen.forgetRepo.push(id);
    },
    command: async (_m, workspace, line) => {
      seen.command.push({ workspace, line });
      return [`ran ${line}`];
    },
  };
  const deps = {
    machine: over.machine === undefined ? MACHINE : over.machine,
    workspaces: over.workspaces ?? [ws("songs", ["hiver.st0"])],
    repos: over.repos ?? [repo("songs")],
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

describe("which repository a project verb lands in", () => {
  it("is the one the address has unfolded", () => {
    const found = resolveWorkspace({
      machine: MACHINE,
      workspaces: [ws("a"), ws("b")],
      repos: [],
      openWs: "b",
    });
    expect("ws" in found && found.ws.name).toBe("b");
  });

  it("is the only one there is, when there is only one", () => {
    const found = resolveWorkspace({
      machine: MACHINE,
      workspaces: [ws("a")],
      repos: [],
      openWs: null,
    });
    expect("ws" in found && found.ws.name).toBe("a");
  });

  it("REFUSES rather than guessing between several, and names them", () => {
    const found = resolveWorkspace({
      machine: MACHINE,
      workspaces: [ws("a"), ws("b")],
      repos: [],
      openWs: null,
    });
    expect("error" in found && found.error).toMatch(/a, b/);
  });
});

describe("naming a project", () => {
  const w = ws("songs", ["hiver.st0", "albums/été.st0"]);
  it("takes the path, the folder, or the stem", () => {
    expect(findProject(w, "albums/été.st0")?.path).toBe("albums/été.st0");
    expect(findProject(w, "été.st0")?.path).toBe("albums/été.st0");
    expect(findProject(w, "hiver")?.path).toBe("hiver.st0");
    expect(findProject(w, "printemps")).toBeNull();
  });
});

describe("what a field offers", () => {
  const ctx = {
    machine: MACHINE,
    workspaces: [ws("songs", ["hiver.st0"], "songs")],
    repos: [repo("songs"), repo("band")],
    openWs: null,
  };
  it("the five archetypes, the projects, the repositories", () => {
    expect(homeArgValues("project new", 0, ctx)).toEqual([
      "arrangement",
      "mix",
      "video",
      // The two that open on no timeline — packages/song/docs/liveProject.md.
      "live",
      "live-video",
    ]);
    expect(homeArgValues("project delete init", 0, ctx)).toEqual(["hiver.st0"]);
    expect(homeArgValues("system repo remove", 0, ctx)).toEqual([
      "songs",
      "band",
    ]);
  });

  it("offers SYNC what the machine holds, not what pl8 registers", () => {
    // A clone added by hand is still one you can commit and push; offering only registered names would hide the workspace it is about.
    const local = { ...ctx, workspaces: [ws("local-only", [], null)] };
    expect(homeArgValues("system repo sync", 0, local)).toEqual(["local-only"]);
  });
});

describe("project new", () => {
  it("creates the folder with its suffix, in the open repository", async () => {
    const h = harness({
      workspaces: [ws("songs"), ws("band")],
      openWs: "band",
    });
    expect(await h.run("project new arrangement hiver")).toBe(true);
    expect(h.seen.create).toEqual([
      [MACHINE, "band", "hiver.st0", "arrangement"],
    ]);
    expect(h.changes()).toBe(1);
    expect(h.said.join(" ")).toMatch(/band\/hiver\.st0/);
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
    expect(h.seen.create).toEqual([[MACHINE, "band", "hiver.st0", "live"]]);
  });

  it("refuses a name the folder rules refuse", async () => {
    const h = harness();
    await h.run("project new mix a/b");
    expect(h.refused.join(" ")).toMatch(/\//);
    expect(h.seen.create).toEqual([]);
  });

  it("says the project EXISTS when only the push failed", async () => {
    // Raising here would read as a failure and invite a second create of a folder that is there.
    const h = harness({ gripe: "push refusé" });
    await h.run("project new mix hiver");
    expect(h.seen.create).toHaveLength(1);
    expect(h.refused.join(" ")).toMatch(/créé, mais : push refusé/);
  });

  it("says there is no machine rather than failing at the far end", async () => {
    const h = harness({ machine: null });
    await h.run("project new mix hiver");
    expect(h.refused.join(" ")).toMatch(/aucune machine/);
    expect(h.seen.create).toEqual([]);
  });
});

describe("project copy", () => {
  const two = () => [ws("songs", ["hiver.st0"]), ws("band")];

  it("copies into the named workspace, keeping the source's name by default", async () => {
    const h = harness({ workspaces: two(), openWs: "songs" });
    expect(await h.run("project copy hiver band")).toBe(true);
    expect(h.seen.copy).toEqual([
      [MACHINE, "songs", "hiver.st0", "band", "hiver.st0", true],
    ]);
    expect(h.said.join(" ")).toMatch(/band\/hiver\.st0/);
    expect(h.changes()).toBe(1);
  });

  it("renames the copy when a name is given, suffix and all", async () => {
    const h = harness({ workspaces: two(), openWs: "songs" });
    await h.run("project copy hiver band printemps");
    expect(h.seen.copy[0]?.[4]).toBe("printemps.st0");
  });

  // The destination is what commits, so it is ITS repository that decides whether a push is expected.
  it("expects a push when the DESTINATION has a repository", async () => {
    const dest = { ...ws("band"), origin: "git@h:u/band.git" };
    const h = harness({
      workspaces: [ws("songs", ["hiver.st0"]), dest],
      openWs: "songs",
    });
    await h.run("project copy hiver band");
    expect(h.seen.copy[0]?.[5]).toBe(false);
  });

  it("refuses the workspace the project is already in", async () => {
    const h = harness({ workspaces: two(), openWs: "songs" });
    await h.run("project copy hiver songs");
    expect(h.refused.join(" ")).toMatch(/déjà/);
    expect(h.seen.copy).toEqual([]);
  });

  it("refuses a destination that is itself one project", async () => {
    const solo = { ...ws("solo.st0"), isSingleProject: true };
    const h = harness({
      workspaces: [ws("songs", ["hiver.st0"]), solo],
      openWs: "songs",
    });
    await h.run("project copy hiver solo.st0");
    expect(h.refused.join(" ")).toMatch(/jamais listée/);
    expect(h.seen.copy).toEqual([]);
  });

  it("names the projects there are when the source is not one of them", async () => {
    const h = harness({ workspaces: two(), openWs: "songs" });
    await h.run("project copy automne band");
    expect(h.refused.join(" ")).toMatch(/hiver\.st0/);
    expect(h.seen.copy).toEqual([]);
  });

  it("says the copy EXISTS when only the push failed", async () => {
    const h = harness({
      workspaces: two(),
      openWs: "songs",
      gripe: "push refusé",
    });
    await h.run("project copy hiver band");
    expect(h.seen.copy).toHaveLength(1);
    expect(h.refused.join(" ")).toMatch(/copié dans band, mais : push refusé/);
  });

  it("offers the other workspaces, and not the ones a copy would hide in", async () => {
    const solo = { ...ws("solo.st0"), isSingleProject: true };
    const ctx = {
      machine: MACHINE,
      workspaces: [ws("songs", ["hiver.st0"]), ws("band"), solo],
      repos: [],
      openWs: "songs",
    };
    expect(homeArgValues("project copy", 1, ctx)).toEqual(["band"]);
  });
});

describe("project delete, in two halves", () => {
  it("arms the named project and says what confirming does", async () => {
    const h = harness();
    await h.run("project delete init hiver");
    expect(h.deps.armed.current).toEqual({
      workspace: "songs",
      path: "hiver.st0",
    });
    expect(h.said.join(" ")).toMatch(/project delete confirm hiver\.st0/);
    expect(h.seen.remove).toEqual([]);
  });

  it("deletes when the SAME project is named again", async () => {
    const h = harness();
    await h.run("project delete init hiver");
    await h.run("project delete confirm hiver.st0");
    expect(h.seen.remove).toEqual([[MACHINE, "songs", "hiver.st0"]]);
  });

  it("refuses a confirm nothing armed", async () => {
    const h = harness();
    await h.run("project delete confirm hiver.st0");
    expect(h.refused.join(" ")).toMatch(/rien n'a été désigné/);
    expect(h.seen.remove).toEqual([]);
  });

  it("refuses a confirm naming ANOTHER project", async () => {
    // Otherwise the second line is a formality, which is the one thing it must not be.
    const h = harness({ workspaces: [ws("songs", ["hiver.st0", "été.st0"])] });
    await h.run("project delete init hiver");
    await h.run("project delete confirm été.st0");
    expect(h.refused.join(" ")).toMatch(/ce n'est pas ce qui a été désigné/);
    expect(h.seen.remove).toEqual([]);
  });

  it("is DISARMED by any command in between", async () => {
    // The same rule the graph's pending insert follows: an armed destructive verb must not sit waiting behind three unrelated lines.
    const h = harness();
    await h.run("project delete init hiver");
    await h.run("system repo sync songs");
    await h.run("project delete confirm hiver.st0");
    expect(h.refused.join(" ")).toMatch(/rien n'a été désigné/);
    expect(h.seen.remove).toEqual([]);
  });
});

describe("system repo", () => {
  it("registers a repository, THEN clones it", async () => {
    const h = harness();
    await h.run("system repo add git@h:u/band.git");
    expect(h.seen.addRepo).toEqual(["git@h:u/band.git"]);
    expect(h.seen.clone).toEqual([["git@h:u/band.git"]]);
  });

  it("forgets by NAME, and says the files stay", async () => {
    const h = harness({ repos: [repo("songs"), repo("band")] });
    await h.run("system repo remove band");
    expect(h.seen.forgetRepo).toEqual(["id-band"]);
    expect(h.said.join(" ")).toMatch(/les fichiers restent/);
  });

  it("refuses a repository nobody registered, and names the ones there are", async () => {
    const h = harness({ repos: [repo("songs")] });
    await h.run("system repo remove nope");
    expect(h.refused.join(" ")).toMatch(/songs/);
    expect(h.seen.forgetRepo).toEqual([]);
  });

  it("syncs by PULLING first, then committing and pushing", async () => {
    // That order because `project commit` pushes, and a push is refused when the remote has moved.
    const h = harness({ workspaces: [ws("songs", [], "songs")] });
    await h.run("system repo sync songs");
    expect(h.seen.command).toEqual([
      { workspace: "songs", line: "project pull" },
      { workspace: "songs", line: "project commit sync" },
    ]);
  });

  it("refuses a workspace this machine does not hold", async () => {
    const h = harness();
    await h.run("system repo sync nope");
    expect(h.refused.join(" ")).toMatch(/aucun espace de travail/);
    expect(h.seen.command).toEqual([]);
  });
});

describe("system workspace new", () => {
  it("makes an EMPTY workspace, and says so", async () => {
    const h = harness();
    await h.run("system workspace new hiver");
    expect(h.seen.newWorkspace).toEqual([[MACHINE, "hiver"]]);
    // No project: the archetype is asked for by the editor, on the empty workspace.
    expect(h.said.join(" ")).toMatch(/vide et sans dépôt/);
  });

  it("strips a suffix somebody typed — a workspace is a plain folder", async () => {
    const h = harness();
    await h.run("system workspace new hiver.st0");
    expect(h.seen.newWorkspace).toEqual([[MACHINE, "hiver"]]);
  });

  it("refuses a name git could not carry, before touching the machine", async () => {
    const h = harness();
    await h.run("system workspace new a/b");
    expect(h.seen.newWorkspace).toEqual([]);
    expect(h.refused.join(" ")).toMatch(/« \/ »/);
  });
});

describe("system workspace publish", () => {
  it("sets the remote and registers the repository, in that order", async () => {
    const h = harness();
    await h.run("system workspace publish songs git@h:u/songs.git");
    expect(h.seen.publish).toEqual([[MACHINE, "songs", "git@h:u/songs.git"]]);
    // The register is what makes the short address resolve, so it is part of publishing.
    expect(h.seen.addRepo).toEqual(["git@h:u/songs.git"]);
    expect(h.said.join(" ")).toMatch(/\/songs\//);
  });

  it("refuses a workspace that already has one rather than letting git say so later", async () => {
    const h = harness({
      workspaces: [{ ...ws("songs", ["hiver.st0"]), origin: "h/u/songs" }],
    });
    await h.run("system workspace publish songs git@h:u/other.git");
    expect(h.seen.publish).toEqual([]);
    expect(h.refused.join(" ")).toMatch(/déjà un dépôt/);
  });

  it("offers only the workspaces that have none", () => {
    const workspaces = [ws("local"), { ...ws("cloned"), origin: "h/u/cloned" }];
    expect(
      homeArgValues("system workspace publish", 0, {
        machine: MACHINE,
        workspaces,
        repos: [],
        openWs: null,
      }),
    ).toEqual(["local"]);
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
    expect(h.deps.armed.current?.path).toBe("hiver.st0");
  });
});
