// homeCommands.ts — the HOME page's own command vocabulary: what the bar under the projects
// list offers, and what a line does. None of them the editor's — this screen has no
// project, no engine session and no file open, so `LOCAL_COMMANDS` would be a catalogue of
// things that cannot be done here. Pure but for the acts it is handed. See ../../docs/projects.md.

import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import { PROJECT_SHAPES } from "@studio/song-schema/yaml/projectSchema";
import type { AccountWorkspace, RepoProject } from "@studio/web-protocol";
import type { PaletteArg, PaletteCommand } from "../components/CommandBar";
// `m` is the file service in these branches, so the catalogue comes in under its own name.
import { m as msg } from "../paraglide/messages.js";
import type { AccountFiles } from "./api";
import { projectFolderName, workspaceFolderName } from "./projectName";
import {
  copyProject,
  createProject,
  createWorkspace,
  deleteProject,
  renameProject,
} from "./workspaceOps";

/** The catalogue, in the same shape the editor's is — imperative, no example, no full stop, 60 characters at most in each language. */
export const HOME_COMMANDS: {
  canonical: string;
  readable: { en: string; fr: string };
  args: PaletteArg[];
}[] = [
  {
    canonical: "project new",
    readable: {
      en: "Create a project in the open workspace",
      fr: "Créer un projet dans l'espace de travail ouvert",
    },
    args: [
      {
        name: "type",
        kind: "choice",
        hint: PROJECT_SHAPES.join(" · "),
      },
      {
        name: "name",
        kind: "text",
        hint: "its name — the folder gets the .k7 suffix",
      },
    ],
  },
  {
    canonical: "project copy",
    readable: {
      en: "Copy a project into another workspace",
      fr: "Copier un projet vers un autre espace de travail",
    },
    args: [
      { name: "name", kind: "file", hint: "a project of the open workspace" },
      { name: "workspace", kind: "choice", hint: "where the copy lands" },
      {
        name: "new_name",
        kind: "text",
        hint: "the copy's name — the source's, left blank",
        optional: true,
      },
    ],
  },
  {
    canonical: "project rename",
    readable: {
      en: "Rename a project",
      fr: "Renommer un projet",
    },
    args: [
      { name: "name", kind: "file", hint: "a project of the open workspace" },
      {
        name: "new_name",
        kind: "text",
        hint: "its new name — the suffix is kept",
      },
    ],
  },
  /** Deleting is TWO verbs: naming the project twice is what makes the second Enter a decision, and `init` is what SAYS what will happen. */
  {
    canonical: "project delete init",
    readable: {
      en: "Say which project to delete, and what that does",
      fr: "Désigner le projet à supprimer, et dire ce que ça fait",
    },
    args: [
      { name: "name", kind: "file", hint: "a project of the open workspace" },
    ],
  },
  {
    canonical: "project delete confirm",
    readable: {
      en: "Delete the project just named",
      fr: "Supprimer le projet désigné",
    },
    args: [{ name: "name", kind: "file", hint: "the same project again" }],
  },
  {
    canonical: "system workspace new",
    readable: {
      en: "Make an empty workspace",
      fr: "Créer un espace de travail vide",
    },
    args: [
      {
        name: "name",
        kind: "text",
        hint: "its name — the folder takes it, and it starts empty",
      },
    ],
  },
];

/** The catalogue as the bar takes it, with `readable` resolved ONCE — the same thing `buildPaletteCommands` does for the editor. */
export function buildHomePalette(locale: string): PaletteCommand[] {
  const lang = locale.startsWith("fr") ? "fr" : "en";
  return HOME_COMMANDS.map((c) => ({
    canonical: c.canonical,
    label: c.canonical,
    names: [c.canonical],
    readable: c.readable[lang],
    readableBy: { ...c.readable },
    args: c.args,
  }));
}

/** What this screen knows when a line is run: the file service, what it holds, and what pl8 registers. */
export interface HomeContext {
  fileService: AccountFiles | null;
  workspaces: AccountWorkspace[];
  /** The workspace the address has unfolded (`?ws=`), or null. */
  openWs: string | null;
}

/** Which workspace a `project …` line acts in: the address first, then an account holding exactly one — anything else refused by name. */
export function resolveWorkspace(
  ctx: HomeContext,
): { ws: AccountWorkspace } | { error: string } {
  const open = ctx.openWs
    ? ctx.workspaces.find((w) => w.name === ctx.openWs)
    : null;
  if (open) return { ws: open };
  if (ctx.workspaces.length === 1)
    return { ws: ctx.workspaces[0] as AccountWorkspace };
  if (!ctx.workspaces.length)
    return {
      error: msg["hc.noWorkspaces"](),
    };
  return {
    error: msg["hc.whichRepo"]({
      names: ctx.workspaces.map((w) => w.name).join(", "),
    }),
  };
}

/** A project of that workspace, named by its path or by the folder's stem (`hiver`). */
export function findProject(
  ws: AccountWorkspace,
  name: string,
): RepoProject | null {
  const want = name.trim();
  const stem = (p: RepoProject) =>
    (p.path.split("/").pop() ?? p.path).replace(/\.[^.]+$/, "");
  return (
    ws.projects.find((p) => p.path === want) ??
    ws.projects.find((p) => (p.path.split("/").pop() ?? p.path) === want) ??
    ws.projects.find((p) => stem(p) === want) ??
    null
  );
}

/** One param's whole vocabulary, for the field that is open — answered synchronously, this page already polling both services. */
export function homeArgValues(
  canonical: string,
  argIndex: number,
  ctx: HomeContext,
): string[] {
  if (canonical === "project new" && argIndex === 0) return [...PROJECT_SHAPES];
  if (canonical.startsWith("project delete") && argIndex === 0) {
    const found = resolveWorkspace(ctx);
    return "ws" in found ? found.ws.projects.map((p) => p.path) : [];
  }
  if (canonical === "project rename" && argIndex === 0) {
    const found = resolveWorkspace(ctx);
    return "ws" in found ? found.ws.projects.map((p) => p.path) : [];
  }
  if (canonical === "project copy") {
    const found = resolveWorkspace(ctx);
    if (argIndex === 0)
      return "ws" in found ? found.ws.projects.map((p) => p.path) : [];
    // The same list the dialog offers, and for the same two reasons — see RepoList's `targetsFor`.
    if (argIndex === 1)
      return ctx.workspaces
        .filter(
          (w) =>
            !w.isSingleProject &&
            (!("ws" in found) || w.name !== found.ws.name),
        )
        .map((w) => w.name);
  }
  return [];
}

/** The project a `project delete init` has named, waiting for its confirm. */
export interface ArmedDelete {
  workspace: string;
  path: string;
}

/** What a line DOES, injected — so the dispatcher below is testable without a file service, and the bar and the buttons cannot diverge. */
export interface HomeActs {
  create: typeof createProject;
  copy: typeof copyProject;
  rename: typeof renameProject;
  remove: typeof deleteProject;
  newWorkspace: typeof createWorkspace;
}

export const HOME_ACTS: HomeActs = {
  create: createProject,
  copy: copyProject,
  rename: renameProject,
  remove: deleteProject,
  newWorkspace: createWorkspace,
};

export interface HomeDeps extends HomeContext {
  acts: HomeActs;
  /** What happened, or where a long act has got to — the line under the bar. */
  say: (text: string) => void;
  /** …and the same channel for a NO — two of them, because a screen cannot otherwise tell them apart. */
  refuse: (text: string) => void;
  /** Re-read both services without waiting for the poll: after a write we already know. */
  changed: () => void;
  /** The project `project delete init` named, held between the two halves — a ref, CONSUMED by every line, the confirm or not. */
  armed: { current: ArmedDelete | null };
}

/** The file service, or the sentence saying why there is nothing to act on. */
const machineOf = (d: HomeDeps): AccountFiles | null => {
  if (d.fileService) return d.fileService;
  d.refuse(msg["hc.noFiles"]());
  return null;
};

/** Run one line of this screen's vocabulary; `false` for a line no verb here matches, so the caller says 'unknown command' once. */
export async function runHomeCommand(
  raw: string,
  d: HomeDeps,
): Promise<boolean> {
  const line = raw.trim();
  if (!line) return true;
  // Longest name first: `project delete init` must not be read as `project delete` with a word after it.
  const spec = [...HOME_COMMANDS]
    .sort((a, b) => b.canonical.length - a.canonical.length)
    .find((c) => line === c.canonical || line.startsWith(`${c.canonical} `));
  if (!spec) return false;
  const rest = line.slice(spec.canonical.length).trim();
  // Consumed HERE, before any branch: whatever this line is, the arming belonged to the one before it.
  const armed = d.armed.current;
  d.armed.current = null;

  switch (spec.canonical) {
    case "project new": {
      const [type, ...words] = rest.split(/\s+/).filter(Boolean);
      const name = words.join(" ");
      if (!type || !name)
        return use(d.refuse, "usage: project new <type> <name>");
      if (!(PROJECT_SHAPES as readonly string[]).includes(type))
        return use(
          d.refuse,
          msg["hc.notAShape"]({ type, shapes: PROJECT_SHAPES.join(", ") }),
        );
      const { folder, error } = projectFolderName(name, "k7");
      if (error) return use(d.refuse, error);
      const m = machineOf(d);
      if (!m) return true;
      const found = resolveWorkspace(d);
      if ("error" in found) return use(d.refuse, found.error);
      try {
        const { project, missing } = await d.acts.create(
          m,
          found.ws.name,
          folder,
          d.say,
          type as ProjectShape,
        );
        d.changed();
        d.say(
          missing.length
            ? msg["project.missingModules"]({
                project,
                modules: missing.join(", "),
              })
            : `+ ${found.ws.name}/${project}`,
        );
      } catch (e) {
        d.refuse(`project new: ${(e as Error).message}`);
      }
      return true;
    }

    case "project copy": {
      const [name, to, ...words] = rest.split(/\s+/).filter(Boolean);
      if (!name || !to)
        return use(
          d.refuse,
          "usage: project copy <project> <workspace> [name of the copy]",
        );
      const found = resolveWorkspace(d);
      if ("error" in found) return use(d.refuse, found.error);
      const p = findProject(found.ws, name);
      if (!p) return use(d.refuse, projectGripe(found.ws, name));
      const dest = d.workspaces.find((w) => w.name === to);
      if (!dest) return use(d.refuse, msg["hc.noWorkspaceNamed"]({ name: to }));
      // Said rather than attempted: the file service refuses both too, and later.
      if (dest.name === found.ws.name)
        return use(d.refuse, msg["hc.copySameWs"]({ to }));
      if (dest.isSingleProject)
        return use(d.refuse, msg["hc.copyIntoProject"]({ to }));
      // No name given is the source's own, suffix included, which `projectFolderName` puts back.
      const label = words.join(" ") || (p.path.split("/").pop() ?? p.path);
      const { folder, error } = projectFolderName(label, p.app);
      if (error) return use(d.refuse, error);
      const m = machineOf(d);
      if (!m) return true;
      try {
        await d.acts.copy(m, found.ws.name, p.path, dest.name, folder, d.say);
        d.changed();
        d.say(`+ ${to}/${folder}`);
      } catch (e) {
        d.refuse(`project copy: ${(e as Error).message}`);
      }
      return true;
    }

    case "project rename": {
      const [name, ...words] = rest.split(/\s+/).filter(Boolean);
      const label = words.join(" ");
      if (!name || !label)
        return use(d.refuse, "usage: project rename <project> <new name>");
      const found = resolveWorkspace(d);
      if ("error" in found) return use(d.refuse, found.error);
      const p = findProject(found.ws, name);
      if (!p) return use(d.refuse, projectGripe(found.ws, name));
      const { folder, error } = projectFolderName(label, p.app);
      if (error) return use(d.refuse, error);
      // Said rather than attempted: the file service would answer the same thing, one round trip later.
      if (folder === p.path.split("/").pop())
        return use(d.refuse, msg["hc.renameSame"]({ name: folder }));
      const m = machineOf(d);
      if (!m) return true;
      try {
        await d.acts.rename(m, found.ws.name, p.path, folder, d.say);
        d.changed();
        d.say(`${p.path} → ${folder}`);
      } catch (e) {
        d.refuse(`project rename: ${(e as Error).message}`);
      }
      return true;
    }

    case "project delete init": {
      if (!rest) return use(d.refuse, "usage: project delete init <project>");
      const found = resolveWorkspace(d);
      if ("error" in found) return use(d.refuse, found.error);
      const p = findProject(found.ws, rest);
      if (!p) return use(d.refuse, projectGripe(found.ws, rest));
      d.armed.current = { workspace: found.ws.name, path: p.path };
      // What the dialog's paragraph says, said here instead: 'are you sure?' on its own names nothing.
      d.say(msg["hc.deleteArmed"]({ path: p.path }));
      return true;
    }

    case "project delete confirm": {
      if (!rest)
        return use(d.refuse, "usage: project delete confirm <project>");
      if (!armed) return use(d.refuse, msg["hc.nothingArmed"]({ name: rest }));
      const found = resolveWorkspace(d);
      if ("error" in found) return use(d.refuse, found.error);
      const p = findProject(found.ws, rest);
      // NAMED AGAIN, and it has to be the same one, or the second line would be the formality it must not be.
      if (!p || p.path !== armed.path || found.ws.name !== armed.workspace)
        return use(
          d.refuse,
          msg["hc.notWhatWasArmed"]({
            what: `${armed.workspace}/${armed.path}`,
          }),
        );
      const m = machineOf(d);
      if (!m) return true;
      try {
        await d.acts.remove(m, armed.workspace, p.path, d.say);
        d.changed();
        d.say(`− ${armed.workspace}/${p.path}`);
      } catch (e) {
        d.refuse(`project delete: ${(e as Error).message}`);
      }
      return true;
    }

    case "system workspace new": {
      if (!rest) return use(d.refuse, "usage: system workspace new <name>");
      const { folder, error } = workspaceFolderName(rest);
      if (error) return use(d.refuse, error);
      const m = machineOf(d);
      if (!m) return true;
      try {
        const { workspace } = await d.acts.newWorkspace(m, folder, d.say);
        d.changed();
        // Said out loud: it holds nothing, and the editor is where the first project is chosen.
        d.say(msg["hc.workspaceMade"]({ workspace }));
      } catch (e) {
        d.refuse(`system workspace new: ${(e as Error).message}`);
      }
      return true;
    }
  }
  return false;
}

/** No such project, with the ones there are — a refusal that names nothing is a refusal you retype. */
const projectGripe = (ws: AccountWorkspace, name: string): string =>
  msg["hc.noProject"]({
    name,
    workspace: ws.name,
    list: ws.projects.length
      ? ` — ${ws.projects.map((x) => x.path).join(", ")}`
      : "",
  });

/** Say it and answer `true` — the branches above are one statement each because of it. */
function use(to: (s: string) => void, text: string): boolean {
  to(text);
  return true;
}
