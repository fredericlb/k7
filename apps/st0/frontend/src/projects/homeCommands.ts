// homeCommands.ts — the HOME page's own command vocabulary: what the bar under the projects
// list offers, and what a line does. Six verbs, none of them the editor's — this screen has no
// project, no engine session and no file open, so `LOCAL_COMMANDS` would be a catalogue of
// things that cannot be done here. Pure but for the acts it is handed. See ../../docs/projects.md.

import type { ProjectShape } from "@studio/song/yaml/projectSchema";
import { PROJECT_SHAPES } from "@studio/song/yaml/projectSchema";
import type {
  MachineWorkspace,
  RepoProject,
  RepoSummary,
} from "@studio/web-protocol";
import type { PaletteArg, PaletteCommand } from "../components/CommandBar";
import { engineMachine, type Machine, projects as registry } from "./api";
import {
  createProjectOnMachine,
  deleteProjectOnMachine,
  ensureWorkspace,
} from "./machine";
import { projectFolderName } from "./projectName";

/**
 * The catalogue, in the same shape the editor's is (`palette.ts`): a canonical name, a sentence
 * in each language, and the params the form asks for.
 *
 * The rules are the catalogue's everywhere — imperative, no example, no full stop, **60
 * characters at most in each language** — and `homeCommands.test.ts` holds this half to them, as
 * `palette.test.ts` and `commandSpec.test.ts` hold the other two. A row is the sentence with the
 * command's name at the right of it, so a longer line is a truncated one.
 */
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
  /**
   * Deleting is TWO verbs, and that is the bar's way of doing what a dialog does with a second
   * button. A palette can dispatch a destructive line from one Enter on a fuzzy match; naming the
   * project twice, in two commands, is what makes the second Enter a decision rather than a
   * reflex — and `init` is what SAYS what will happen, since there is no dialog to read it in.
   */
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

/** The catalogue as the bar takes it. `readable` is resolved ONCE, here, so nothing downstream
 *  has a table to choose from — the same thing `buildPaletteCommands` does for the editor. */
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

/**
 * Which workspace a `project …` line acts in — the one question these verbs do not ask.
 *
 * The address answers it first: a repository unfolded is the one you are looking at. Failing
 * that, a machine holding exactly ONE workspace has no ambiguity to resolve either. Anything
 * else is refused by name rather than guessed: creating a project in the wrong repository is a
 * commit pushed somewhere nobody was looking.
 *
 * The alternative would be a third argument on every project verb, which is the repository you
 * are already standing in — and `project new arrangement hiver` is the line somebody types.
 */
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

/**
 * One param's whole vocabulary, for the field that is open — the bar fetches it once per field.
 *
 * Everything here is already in this page's hands (it polls both services), so this answers
 * synchronously where the editor's `listArg` is a round trip.
 */
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
  if (canonical === "system repo remove" && argIndex === 0)
    return ctx.repos.map((r) => r.name);
  // …and SYNC offers what the MACHINE holds rather than what pl8 registers: a clone added by
  // hand is one you can still commit and push, and it is the register that is missing a row.
  if (canonical === "system repo sync" && argIndex === 0)
    return ctx.workspaces.map((w) => w.repoName || w.name);
  return [];
}

/** The project a `project delete init` has named, waiting for its confirm. */
export interface ArmedDelete {
  workspace: string;
  path: string;
}

/**
 * What a line DOES, injected — so the dispatcher below is testable without a machine, and so the
 * bar and the buttons on the same screen cannot come to mean different things: both go through
 * these, and they are `machine.ts`'s.
 */
export interface HomeActs {
  create: typeof createProjectOnMachine;
  remove: typeof deleteProjectOnMachine;
  clone: typeof ensureWorkspace;
  addRepo: (uri: string) => Promise<unknown>;
  forgetRepo: (id: string) => Promise<unknown>;
  command: typeof engineMachine.command;
}

export const HOME_ACTS: HomeActs = {
  create: createProjectOnMachine,
  remove: deleteProjectOnMachine,
  clone: ensureWorkspace,
  addRepo: (uri) => registry.add(uri),
  forgetRepo: (id) => registry.remove(id),
  command: engineMachine.command,
};

export interface HomeDeps extends HomeContext {
  acts: HomeActs;
  /** What happened, or where a long act has got to — the line under the bar. */
  say: (text: string) => void;
  /** …and the same channel for a NO. Two of them because a screen cannot tell them apart
   *  otherwise, which is the lesson `CommandHost.refuse` records for the brain's verbs. */
  refuse: (text: string) => void;
  /** Re-read both services without waiting for the poll: after a write we already know. */
  changed: () => void;
  /**
   * The project `project delete init` named, held between the two halves.
   *
   * A ref rather than state: it is read by the very next command and never drawn. CONSUMED by
   * every line, including the ones that are not the confirm — the same rule the graph's pending
   * insert follows, and here it is what stops a destructive verb sitting armed behind three
   * unrelated commands.
   */
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

/**
 * Run one line of this screen's vocabulary; answers whether it was one at all.
 *
 * `false` for a line no verb here matches, so the caller can say "unknown command" once rather
 * than every branch saying it. Everything else is reported through `say`/`refuse`.
 */
export async function runHomeCommand(
  raw: string,
  d: HomeDeps,
): Promise<boolean> {
  const line = raw.trim();
  if (!line) return true;
  // Longest name first: `project delete init` must not be read as `project delete` with a word
  // after it, and `system repo add` shares its two first tokens with the other two.
  const spec = [...HOME_COMMANDS]
    .sort((a, b) => b.canonical.length - a.canonical.length)
    .find((c) => line === c.canonical || line.startsWith(`${c.canonical} `));
  if (!spec) return false;
  const rest = line.slice(spec.canonical.length).trim();
  // Consumed HERE, before any branch: whatever this line is, the arming belonged to the one
  // before it. `project delete confirm` reads the value below off this local copy.
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
        // The folder EXISTS whatever the push did, so a failed push is said beside the success
        // rather than instead of it — the same reading the dialog takes.
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
      // What the dialog's paragraph says, said here instead: this is the only place a person
      // reads what confirming will do, and "are you sure?" on its own names nothing.
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
      // NAMED AGAIN, and it has to be the same one: a confirm that deleted whatever was armed
      // would make the second line a formality, which is the one thing it must not be.
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

    case "system repo add": {
      const uri = rest;
      if (!uri) return use(d.refuse, "usage: system repo add <uri ssh>");
      const m = machineOf(d);
      if (!m) return true;
      try {
        // The REGISTER first, then the clone. pl8 is what makes `/<dépôt>/<projet>` resolve from
        // any machine; the clone is what makes the row appear on this one. See ProjectsPane.
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
        // Said out loud, because the row does NOT go away: what changes is the address, and
        // taking a name out of a list must not read as having deleted somebody's files.
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
      /**
       * PULL, then commit and push — and the second runs whatever the first said.
       *
       * That order because `project commit` pushes, and a push is refused when the remote has
       * moved: pulling first is what makes the push land in the ordinary case. And the commit
       * runs even after a pull that failed, because it is the half that protects work — a
       * refused `pull --ff-only` (a tree with local edits over the same files) must not leave
       * this morning's changes uncommitted as well as unmerged.
       */
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

/** Say it and answer `true` — the branches above are one statement each because of it. */
function use(to: (s: string) => void, text: string): boolean {
  to(text);
  return true;
}
