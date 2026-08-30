// homeCommands.ts — the HOME page's own command vocabulary: what the bar under the projects
// list offers, and what a line does. Six verbs, none of them the editor's — this screen has no
// project, no engine session and no file open, so `LOCAL_COMMANDS` would be a catalogue of
// things that cannot be done here. Pure but for the acts it is handed. See ../../docs/projects.md.

import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import { PROJECT_SHAPES } from "@studio/song-schema/yaml/projectSchema";
import type {
  MachineWorkspace,
  RepoProject,
  RepoSummary,
} from "@studio/web-protocol";
import type { PaletteArg, PaletteCommand } from "../components/CommandBar";
import { engineMachine, type Machine, projects as registry } from "./api";
import {
  createLocalWorkspace,
  createProjectOnMachine,
  deleteProjectOnMachine,
  ensureWorkspace,
  publishWorkspace,
} from "./machine";
import { projectFolderName, workspaceFolderName } from "./projectName";

/** The catalogue, in the same shape the editor's is — imperative, no example, no full stop, 60 characters at most in each language. */
export const HOME_COMMANDS: {
  canonical: string;
  readable: { en: string; fr: string };
  args: PaletteArg[];
}[] = [
  {
    canonical: "project new",
    readable: {
      en: "Create a project in the open repository",
      fr: "Créer un projet dans le dépôt ouvert",
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
        hint: "its name — the folder gets the .st0 suffix",
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
      { name: "name", kind: "file", hint: "a project of the open repository" },
    ],
  },
  {
    canonical: "project delete confirm",
    readable: {
      en: "Delete the project just named, and push it",
      fr: "Supprimer le projet désigné, et pousser",
    },
    args: [{ name: "name", kind: "file", hint: "the same project again" }],
  },
  {
    canonical: "system workspace new",
    readable: {
      en: "Make an empty workspace here, with no repository behind it",
      fr: "Créer un espace de travail vide ici, sans dépôt derrière",
    },
    args: [
      {
        name: "name",
        kind: "text",
        hint: "its name — the folder takes it, and it starts empty",
      },
    ],
  },
  {
    canonical: "system workspace publish",
    readable: {
      en: "Give a local workspace its first repository, and push",
      fr: "Donner son premier dépôt à un espace local, et pousser",
    },
    args: [
      { name: "workspace", kind: "choice", hint: "one with no repository yet" },
      {
        name: "repo_url",
        kind: "text",
        hint: "an SSH URI — the repository must exist and be empty",
      },
    ],
  },
  {
    canonical: "system repo add",
    readable: {
      en: "Register a repository and clone it here",
      fr: "Inscrire un dépôt et le cloner ici",
    },
    args: [
      {
        name: "repo_url",
        kind: "text",
        hint: "an SSH URI — git@host:user/repo.git",
      },
    ],
  },
  {
    canonical: "system repo remove",
    readable: {
      en: "Take a repository out of the register",
      fr: "Retirer un dépôt du registre",
    },
    args: [
      { name: "repo_name", kind: "choice", hint: "a registered repository" },
    ],
  },
  {
    canonical: "system repo sync",
    readable: {
      en: "Commit, push and pull a repository",
      fr: "Committer, pousser et tirer un dépôt",
    },
    args: [
      {
        name: "repo_name",
        kind: "choice",
        hint: "a repository on this machine",
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

/** What this screen knows when a line is run: the machine, what it holds, and what pl8 registers. */
export interface HomeContext {
  machine: Machine | null;
  workspaces: MachineWorkspace[];
  repos: RepoSummary[];
  /** The workspace the address has unfolded (`?ws=`), or null. */
  openWs: string | null;
}

/** Which workspace a `project …` line acts in: the address first, then a machine holding exactly one — anything else refused by name. */
export function resolveWorkspace(
  ctx: HomeContext,
): { ws: MachineWorkspace } | { error: string } {
  const open = ctx.openWs
    ? ctx.workspaces.find((w) => w.name === ctx.openWs)
    : null;
  if (open) return { ws: open };
  if (ctx.workspaces.length === 1)
    return { ws: ctx.workspaces[0] as MachineWorkspace };
  if (!ctx.workspaces.length)
    return {
      error:
        "aucun espace de travail sur cette machine — commencez par : system repo add <uri>",
    };
  return {
    error: `quel dépôt ? ouvrez-en un d'abord (${ctx.workspaces
      .map((w) => w.name)
      .join(", ")})`,
  };
}

/** A project of that workspace, named by its path or by the folder's stem (`hiver`). */
export function findProject(
  ws: MachineWorkspace,
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
  // Only the ones that HAVE none: offering the rest would offer an act that is refused by definition.
  if (canonical === "system workspace publish" && argIndex === 0)
    return ctx.workspaces.filter((w) => !w.origin).map((w) => w.name);
  if (canonical === "system repo remove" && argIndex === 0)
    return ctx.repos.map((r) => r.name);
  // …and SYNC offers what the MACHINE holds rather than what pl8 registers: a clone added by hand is still one you can push.
  if (canonical === "system repo sync" && argIndex === 0)
    return ctx.workspaces.map((w) => w.repoName || w.name);
  return [];
}

/** The project a `project delete init` has named, waiting for its confirm. */
export interface ArmedDelete {
  workspace: string;
  path: string;
}

/** What a line DOES, injected — so the dispatcher below is testable without a machine, and the bar and the buttons cannot diverge. */
export interface HomeActs {
  create: typeof createProjectOnMachine;
  remove: typeof deleteProjectOnMachine;
  clone: typeof ensureWorkspace;
  newWorkspace: typeof createLocalWorkspace;
  publish: typeof publishWorkspace;
  addRepo: (uri: string) => Promise<unknown>;
  forgetRepo: (id: string) => Promise<unknown>;
  command: typeof engineMachine.command;
}

export const HOME_ACTS: HomeActs = {
  create: createProjectOnMachine,
  remove: deleteProjectOnMachine,
  clone: ensureWorkspace,
  newWorkspace: createLocalWorkspace,
  publish: publishWorkspace,
  addRepo: (uri) => registry.add(uri),
  forgetRepo: (id) => registry.remove(id),
  command: engineMachine.command,
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

/** The machine, or the sentence saying why there is nothing to act on. */
const machineOf = (d: HomeDeps): Machine | null => {
  if (d.machine) return d.machine;
  d.refuse(
    "aucune machine moteur joignable — un projet est un dossier sur la machine",
  );
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
        return use(d.refuse, "usage: project new <type> <nom>");
      if (!(PROJECT_SHAPES as readonly string[]).includes(type))
        return use(
          d.refuse,
          `« ${type} » n'est pas un archétype — ${PROJECT_SHAPES.join(", ")}`,
        );
      const { folder, error } = projectFolderName(name, "st0");
      if (error) return use(d.refuse, error);
      const m = machineOf(d);
      if (!m) return true;
      const found = resolveWorkspace(d);
      if ("error" in found) return use(d.refuse, found.error);
      try {
        const { project, gripe } = await d.acts.create(
          m,
          found.ws.name,
          folder,
          d.say,
          type as ProjectShape,
        );
        d.changed();
        // The folder EXISTS whatever the push did, so a failed push is said beside the success rather than instead of it.
        if (gripe) d.refuse(`${project} créé, mais : ${gripe}`);
        else d.say(`+ ${found.ws.name}/${project}`);
      } catch (e) {
        d.refuse(`project new: ${(e as Error).message}`);
      }
      return true;
    }

    case "project delete init": {
      if (!rest) return use(d.refuse, "usage: project delete init <projet>");
      const found = resolveWorkspace(d);
      if ("error" in found) return use(d.refuse, found.error);
      const p = findProject(found.ws, rest);
      if (!p)
        return use(
          d.refuse,
          `aucun projet « ${rest} » dans ${found.ws.name}${
            found.ws.projects.length
              ? ` — ${found.ws.projects.map((x) => x.path).join(", ")}`
              : ""
          }`,
        );
      d.armed.current = { workspace: found.ws.name, path: p.path };
      // What the dialog's paragraph says, said here instead: 'are you sure?' on its own names nothing.
      d.say(
        `${p.path} — le dossier sera recyclé sur la machine et le commit poussé ; ` +
          `le contenu reste dans l'historique git. Pour le faire : project delete confirm ${p.path}`,
      );
      return true;
    }

    case "project delete confirm": {
      if (!rest) return use(d.refuse, "usage: project delete confirm <projet>");
      if (!armed)
        return use(
          d.refuse,
          `rien n'a été désigné — project delete init ${rest} d'abord`,
        );
      const found = resolveWorkspace(d);
      if ("error" in found) return use(d.refuse, found.error);
      const p = findProject(found.ws, rest);
      // NAMED AGAIN, and it has to be the same one, or the second line would be the formality it must not be.
      if (!p || p.path !== armed.path || found.ws.name !== armed.workspace)
        return use(
          d.refuse,
          `ce n'est pas ce qui a été désigné (${armed.workspace}/${armed.path}) — rien n'a été supprimé`,
        );
      const m = machineOf(d);
      if (!m) return true;
      try {
        const { gripe } = await d.acts.remove(
          m,
          armed.workspace,
          p.path,
          d.say,
        );
        d.changed();
        if (gripe) d.refuse(`${p.path} supprimé, mais : ${gripe}`);
        else d.say(`− ${armed.workspace}/${p.path}`);
      } catch (e) {
        d.refuse(`project delete: ${(e as Error).message}`);
      }
      return true;
    }

    case "system workspace new": {
      if (!rest) return use(d.refuse, "usage: system workspace new <nom>");
      const { folder, error } = workspaceFolderName(rest);
      if (error) return use(d.refuse, error);
      const m = machineOf(d);
      if (!m) return true;
      try {
        const { workspace } = await d.acts.newWorkspace(m, folder, d.say);
        d.changed();
        // Said out loud: it holds nothing, and the editor is where the first project is chosen.
        d.say(
          `+ ${workspace} — vide et sans dépôt ; ouvrez-le pour y faire un projet`,
        );
      } catch (e) {
        d.refuse(`system workspace new: ${(e as Error).message}`);
      }
      return true;
    }

    case "system workspace publish": {
      const [name, uri] = rest.split(/\s+/).filter(Boolean);
      if (!name || !uri)
        return use(
          d.refuse,
          "usage: system workspace publish <espace> <uri ssh>",
        );
      const ws = d.workspaces.find((w) => w.name === name);
      if (!ws) return use(d.refuse, `aucun espace de travail « ${name} »`);
      // Said rather than attempted: the machine would refuse it too, and later.
      if (ws.origin)
        return use(
          d.refuse,
          `${name} a déjà un dépôt (${ws.origin}) — publier est pour un espace qui n'en a pas`,
        );
      const m = machineOf(d);
      if (!m) return true;
      try {
        const { registered } = await d.acts.publish(m, name, uri, d.say, (u) =>
          d.acts.addRepo(u),
        );
        d.changed();
        d.say(
          registered
            ? `${name} publié — /${repoShortName(uri)}/… se résout maintenant`
            : `${name} poussé, mais le dépôt n'a pas pu être inscrit — l'adresse courte ne se résout pas`,
        );
      } catch (e) {
        d.refuse(`system workspace publish: ${(e as Error).message}`);
      }
      return true;
    }

    case "system repo add": {
      const uri = rest;
      if (!uri) return use(d.refuse, "usage: system repo add <uri ssh>");
      const m = machineOf(d);
      if (!m) return true;
      try {
        // The REGISTER first, then the clone: pl8 is what makes `/<dépôt>/<projet>` resolve from any machine.
        await d.acts.addRepo(uri);
        d.changed();
        const ws = await d.acts.clone(m, uri, d.say);
        d.say(`+ ${ws}`);
      } catch (e) {
        d.refuse(`system repo add: ${(e as Error).message}`);
      } finally {
        d.changed();
      }
      return true;
    }

    case "system repo remove": {
      if (!rest) return use(d.refuse, "usage: system repo remove <dépôt>");
      const repo = d.repos.find((r) => r.name === rest || r.id === rest);
      if (!repo)
        return use(
          d.refuse,
          `aucun dépôt inscrit sous « ${rest} »${
            d.repos.length ? ` — ${d.repos.map((r) => r.name).join(", ")}` : ""
          }`,
        );
      try {
        await d.acts.forgetRepo(repo.id);
        d.changed();
        // Said out loud, because the row does NOT go away: what changes is the address, not somebody's files.
        d.say(
          `${repo.name} retiré du registre — les fichiers restent, l'adresse /${repo.name}/… ne se résout plus`,
        );
      } catch (e) {
        d.refuse(`system repo remove: ${(e as Error).message}`);
      }
      return true;
    }

    case "system repo sync": {
      if (!rest) return use(d.refuse, "usage: system repo sync <dépôt>");
      const ws = d.workspaces.find(
        (w) => w.repoName === rest || w.name === rest,
      );
      if (!ws)
        return use(
          d.refuse,
          `aucun espace de travail « ${rest} » sur cette machine${
            d.workspaces.length
              ? ` — ${d.workspaces.map((w) => w.name).join(", ")}`
              : ""
          }`,
        );
      const m = machineOf(d);
      if (!m) return true;
      /** PULL, then commit and push — that order because a push is refused when the remote has moved, and the commit runs even after a failed pull. */
      try {
        for (const verb of ["project pull", "project commit sync"]) {
          d.say(`${ws.name}: ${verb}…`);
          const out = await d.acts.command(m, ws.name, verb);
          if (out.length) d.say(`${ws.name}: ${out.join("  ·  ")}`);
        }
        d.changed();
      } catch (e) {
        d.refuse(`system repo sync: ${(e as Error).message}`);
      }
      return true;
    }
  }
  return false;
}

/** The last segment of an SSH URI without `.git` — what pl8 will file it under, and what the address carries. */
const repoShortName = (uri: string): string =>
  (uri.split("/").pop() ?? uri).replace(/\.git$/i, "");

/** Say it and answer `true` — the branches above are one statement each because of it. */
function use(to: (s: string) => void, text: string): boolean {
  to(text);
  return true;
}
