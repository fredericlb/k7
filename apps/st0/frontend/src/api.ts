// api.ts — one server now: st0's own backend, same-origin. The catalogue lives
// there, so browsing it needs no engine and no local service. The LOCAL cache is what the
// moteur plays from, and nothing on this screen reads it.

import { engineAccess } from "@studio/engine-browser/access";
import { JSDSP_FILE } from "@studio/engine-protocol/build";
import type { ProjectMode } from "@studio/engine-protocol/project";
import type { RecordingDay } from "@studio/mediatek/recordings";
import type { FamilyListing } from "@studio/mediatek/types";
import type { FaceablePlugin } from "@studio/song/engineFace";
import type { ModuleStore } from "@studio/ui-module-builder/store";
import {
  type CloneJob,
  ENGINE_TOKEN_HEADER,
  type FileNode,
  type Hints,
  type ModulePresetsFile,
  type ModuleUiFile,
  type PublicEngine,
  type RepoStatus,
  type RepoSummary,
  type SshKeyInfo,
  USER_HEADER,
  WORKSPACE_HEADER,
} from "@studio/web-protocol";
import type { HuntList, HuntRecord } from "@studio/web-protocol/hunt";
import { launchUrl, type ProjectApp } from "@studio/web-protocol/projects";
import { mediatekModuleRefs } from "./moduleRefs";
// Type only, so the cycle with prefs.ts (which needs `engines` from here) never reaches the
// bundle: the preference SHAPE belongs beside the code that merges it.
import type { St0Prefs } from "./prefs";

// The app is mounted under a path (st0.priv.frediver.se/<service>), so every backend
// path below carries it. BASE_URL is vite's `base`; it ends in a slash, trimmed
// here so the literals keep reading as paths.
// Exported because the engine probe needs it too: the relay answers under this same prefix.
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface AuthUser {
  sub?: string;
  name?: string;
  email?: string;
}

/** The folder a song would land in already holds one. Its own type so the dialogue can
 *  offer to replace instead of showing a status code. */
export class SongExists extends Error {}

/**
 * The error a failed response carries, or a status code when it carries none.
 *
 * Every write route answers `{ error }` with a sentence that says WHAT was refused — a path
 * outside the library, a name that is the library's own. Throwing `mkdir 400` instead threw
 * that sentence away, which is how you end up staring at a number: the server knew, and the
 * client dropped it on the floor.
 */
async function failed(
  res: Response,
  what: string,
): Promise<Error & { status?: number }> {
  const detail = (await res.json().catch(() => ({}))) as { error?: string };
  const e: Error & { status?: number } = new Error(
    detail.error ?? `${what} ${res.status}`,
  );
  // Carried, because ONE caller has to tell "there is nothing there" from "it went wrong":
  // a module folder with no module.yaml yet is a state, a dead backend is not.
  e.status = res.status;
  return e;
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw await failed(res, what);
  return (await res.json()) as T;
}

const get = async <T>(path: string, what: string): Promise<T> =>
  json(await fetch(`${BASE}/api/mediatek${path}`), what);

/**
 * Who is signed in, held at module level for the SESSION id.
 *
 * Module state rather than a prop threaded through three components, because this SPA has
 * exactly one gate and therefore exactly one user for its whole life. It is set once, by
 * that gate, before anything below it renders.
 */
let signedInAs = "";
export const currentUser = (): string => signedInAs;

export const auth = {
  // `return_to` is the name the OIDC package reads; `redirect` was silently
  // ignored, which only looked fine while this app owned the origin root.
  loginUrl: `/auth/login?return_to=${encodeURIComponent(window.location.pathname + window.location.search)}`,

  /** The session's user, or null when anonymous. */
  me: async (): Promise<AuthUser | null> => {
    const res = await fetch("/auth/me");
    if (res.status === 401) return null;
    const user = (await json<{ user: AuthUser }>(res, "auth/me")).user;
    // The one place this is learned, so the one place it is recorded.
    signedInAs = user.email ?? user.sub ?? "";
    return user;
  },

  /** Ends the session for the WHOLE origin — studio.sid is shared, so this signs
   *  you out of l8 and m9 too. See apps/l8/AGENTS.md. */
  logout: async (): Promise<void> => {
    await fetch("/auth/logout", { method: "POST" });
    window.location.reload();
  },
};

/** Ce que le lecteur d'une machine rend de lui-même. Le chemin est celui qu'on a DEMANDÉ,
 *  relatif à la médiathèque : mpv ne connaît que l'absolu, et le rendre exposerait
 *  l'arborescence de la machine à un client qui n'en a pas besoin. */
export interface MachinePlayerState {
  path: string | null;
  playing: boolean;
  position: number;
  duration: number;
  /** Plus rien à jouer — la fin d'un morceau, ou rien n'a jamais été chargé. */
  idle: boolean;
}

/** Ce que le portier du file-service veut sur chaque appel : qui demande, et le jeton de la
 *  machine. Écrit une fois — les appels ajoutés pour les projets le répétaient six fois. */
const machineHeaders = (token: string): Record<string, string> => ({
  [USER_HEADER]: currentUser(),
  [ENGINE_TOKEN_HEADER]: token,
});

/**
 * The engine MACHINE's own file service, reached cross-origin and directly — the same seam
 * l8 uses, and the only way to learn a fact about that machine rather than about the
 * library. This app's backend is hosted: it has no scan cache and never will.
 *
 * The origin has to be trusted on that machine (`~/.studio/web-origins.json`, offered by the
 * tray), exactly as l8' is; a refusal reads as a network error here, which is why the
 * caller treats an empty list as "cannot say" and not as "no plugins".
 *
 * Elle est aussi la seule qui puisse ÉCRIRE dans un dépôt — créer ou supprimer un projet —
 * parce qu'elle seule en tient une copie de travail. Voir projects/machine.ts.
 */
export const engineMachine = {
  /**
   * Ask that machine to analyse a library file: waveform envelope, transient onsets, tempo.
   *
   * THIS service cannot: it has no engine, and the engine is what decodes audio. So the
   * machine downloads the file from here, runs its engine, pushes the `.cache` sidecar back
   * beside the audio, and seeds `song.yaml` with the tempo it found. See
   * packages/file-service/src/routes/mediatek.ts.
   *
   * The one route here worth CANCELLING, hence the signal: it answers nothing until the whole
   * decode is done, so a caller that has moved on would otherwise hold a request open for
   * minutes. Cancelling does not stop the work on the far machine — nothing propagates that —
   * but it does stop this tab waiting on an answer it will throw away.
   */
  analyse: async (
    fileBase: string,
    token: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<{ bpm: number; bpmSet: boolean; transients: number }> => {
    const res = await fetch(`${fileBase}/mediatek/analyse`, {
      method: "POST",
      headers: {
        [USER_HEADER]: currentUser(),
        [ENGINE_TOKEN_HEADER]: token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ path }),
      signal,
    });
    return json(res, "analyse");
  },

  /** Wipe that machine's waveform cache — the tray's « Clear waveform cache », the same
   *  file-service route the supervisor calls. Returns how many entries were removed. */
  clearWaveforms: async (fileBase: string, token: string): Promise<number> => {
    const res = await fetch(`${fileBase}/waveforms/clear`, {
      method: "POST",
      headers: {
        [USER_HEADER]: currentUser(),
        [ENGINE_TOKEN_HEADER]: token,
      },
    });
    const { removed } = await json<{ removed: number }>(res, "waveforms");
    return removed ?? 0;
  },

  /**
   * Remember the interface that machine should play through, for the next engine too.
   *
   * TWO calls make one pick: the engine's own `set-audio-device` switches the running one,
   * this makes it survive a restart. They are separate because they are separate facts — a
   * live engine and a file on a disk — and the engine holds no memory of its device by
   * design (engine/moteur/docs/audioDevice.md). Sending only the first is how a machine
   * ends up back on the Windows endpoint after every rebuild, monitoring at four times the
   * latency, with nothing on screen saying so.
   */
  /** Which interface that machine is REMEMBERING — "(system default)" spelled as null when
   *  nothing is pinned, which is the state that leaves the engine on the Windows endpoint. */
  audioDevicePref: async (
    fileBase: string,
    token: string,
  ): Promise<string | null> => {
    const res = await fetch(`${fileBase}/preferences`, {
      headers: {
        [USER_HEADER]: currentUser(),
        [ENGINE_TOKEN_HEADER]: token,
      },
    });
    const { audioDevice } = await json<{ audioDevice: string | null }>(
      res,
      "preferences",
    );
    return audioDevice ?? null;
  },

  setAudioDevice: async (
    fileBase: string,
    token: string,
    name: string,
    type?: string,
  ): Promise<string | null> => {
    const res = await fetch(`${fileBase}/preferences/audio-device`, {
      method: "PUT",
      headers: {
        [USER_HEADER]: currentUser(),
        [ENGINE_TOKEN_HEADER]: token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name, ...(type ? { type } : {}) }),
    });
    const { audioDevice } = await json<{ audioDevice: string | null }>(
      res,
      "audio-device",
    );
    return audioDevice ?? null;
  },

  /** The tail of that machine's merged log (engine + supervisor + file service) — what the
   *  tray's « Show logs » opens, minus the text editor. */
  logs: async (
    fileBase: string,
    token: string,
    tail = 300,
  ): Promise<string[]> => {
    const res = await fetch(`${fileBase}/logs?tail=${tail}`, {
      headers: {
        [USER_HEADER]: currentUser(),
        [ENGINE_TOKEN_HEADER]: token,
      },
    });
    const { lines } = await json<{ lines: string[] }>(res, "logs");
    return lines ?? [];
  },

  // The machine's channel LABELS ("arm", "overheads") were read here, for the one screen that
  // routed a live input: the module builder's audition. Both are gone — a module is auditioned
  // in l8 now, where the input belongs to the project's own track and the file service already
  // reads `~/.studio/preferences.yaml` for it. Nothing here asked for that file for any other
  // reason, so the route is simply not called from the médiathèque any more.

  /**
   * What this machine's engine has scanned.
   *
   * The whole record and not just the names: the ROLE decides a module's ports and the
   * plugin's own category decides where it is filed, so giving every plugin a face needs
   * both (see ../docs/completion.md's neighbour, `@studio/song`'s engineFace.ts). The names
   * are derived here rather than fetched twice.
   */
  plugins: async (
    fileBase: string,
    token: string,
  ): Promise<FaceablePlugin[]> => {
    const res = await fetch(`${fileBase}/plugins`, {
      headers: {
        [USER_HEADER]: currentUser(),
        [ENGINE_TOKEN_HEADER]: token,
      },
    });
    const { plugins } = await json<{ plugins?: FaceablePlugin[] }>(
      res,
      "plugins",
    );
    return plugins ?? [];
  },

  /**
   * Quel espace de travail de cette machine tient déjà ce dépôt, ou `null`.
   *
   * st0 nomme un dépôt par son URI et ne sait rien des dossiers de cette machine-là — c'est
   * exactement la question que l8 pose avant de décider s'il faut cloner quoi que ce soit.
   */
  workspaceForRepo: async (
    fileBase: string,
    token: string,
    uri: string,
  ): Promise<string | null> => {
    const res = await fetch(
      `${fileBase}/workspaces/by-repo?uri=${encodeURIComponent(uri)}`,
      { headers: machineHeaders(token) },
    );
    const { workspace } = await json<{ workspace: string | null }>(
      res,
      "workspace",
    );
    return workspace ?? null;
  },

  /** Lancer le clone, et rendre le job à interroger : un vrai dépôt prend des dizaines de
   *  secondes, ce qui est plus long qu'une requête ne doit rester ouverte. */
  startClone: async (
    fileBase: string,
    token: string,
    uri: string,
  ): Promise<CloneJob> =>
    json(
      await fetch(`${fileBase}/workspaces/clone`, {
        method: "POST",
        headers: {
          ...machineHeaders(token),
          "content-type": "application/json",
        },
        body: JSON.stringify({ uri }),
      }),
      "clone",
    ),

  /** …et l'interroger. `null` pour un job que la machine a oublié : on ne peut pas attendre
   *  ce dont plus personne ne tient l'état. */
  cloneJob: async (
    fileBase: string,
    token: string,
    id: string,
  ): Promise<CloneJob | null> => {
    const res = await fetch(
      `${fileBase}/workspaces/clone/${encodeURIComponent(id)}`,
      { headers: machineHeaders(token) },
    );
    if (res.status === 404) return null;
    return json(res, "clone");
  },

  /**
   * Créer un projet dans l'espace de travail de cette machine.
   *
   * `name` porte DÉJÀ son suffixe (`hiver.m9`) : le service prend le nom brut comme nom de
   * dossier, et c'est le suffixe qui dit quelle application l'ouvrira — ET, depuis
   * projectLifecycle.ts, quel gabarit y est écrit. C'est pourquoi `type` reste « audio » ici
   * sans que ce soit un bug : le nom gagne, et c'est nous qui l'avons construit. Il ne sert
   * qu'au cas où le nom ne réclame rien, ce qui n'arrive pas depuis ce dialogue.
   *
   * `mode` est le seul réglage qui ne peut PAS voyager par le nom, et c'est pour ça qu'il est un
   * champ à part : `arrangement` et `live` habitent tous deux un dossier `.l8` et s'ouvrent tous
   * deux dans l8 — le suffixe dit quelle application, celui-ci dit laquelle de ses deux formes.
   * Omis pour m9 et v1, dont les gabarits n'ont pas cet axe.
   */
  createProject: async (
    fileBase: string,
    token: string,
    workspace: string,
    name: string,
    mode?: ProjectMode,
  ): Promise<string> => {
    const { project } = await json<{ project: string }>(
      await fetch(`${fileBase}/project/create`, {
        method: "POST",
        headers: {
          ...machineHeaders(token),
          [WORKSPACE_HEADER]: workspace,
          "content-type": "application/json",
        },
        body: JSON.stringify({ type: "audio", name, mode }),
      }),
      "création",
    );
    return project;
  },

  /** Décharger le projet et recycler son dossier. Le service le met à la corbeille plutôt que
   *  de l'effacer — le commit qui suit est ce qui le retire du dépôt. */
  deleteProject: async (
    fileBase: string,
    token: string,
    workspace: string,
    path: string,
  ): Promise<void> => {
    await json(
      await fetch(`${fileBase}/project/delete`, {
        method: "POST",
        headers: {
          ...machineHeaders(token),
          [WORKSPACE_HEADER]: workspace,
          "content-type": "application/json",
        },
        body: JSON.stringify({ path }),
      }),
      "suppression",
    );
  },

  /**
   * Le lecteur de CETTE machine : mpv sur ses propres sorties, sans le moteur.
   *
   * Le chemin est RELATIF à la médiathèque et jamais absolu — c'est ce qui fait qu'un client ne
   * peut nommer que ce que cette machine cache. Elle le résout contre sa propre racine.
   * Voir packages/file-service/docs/machinePlayer.md.
   */
  player: {
    state: async (
      fileBase: string,
      token: string,
    ): Promise<MachinePlayerState> =>
      json(
        await fetch(`${fileBase}/player`, { headers: machineHeaders(token) }),
        "lecteur",
      ),

    play: async (
      fileBase: string,
      token: string,
      path: string,
      from = 0,
    ): Promise<MachinePlayerState> =>
      json(
        await fetch(`${fileBase}/player/play`, {
          method: "POST",
          headers: {
            ...machineHeaders(token),
            "content-type": "application/json",
          },
          body: JSON.stringify({ path, from }),
        }),
        "lecteur",
      ),

    pause: async (
      fileBase: string,
      token: string,
      paused: boolean,
    ): Promise<MachinePlayerState> =>
      json(
        await fetch(`${fileBase}/player/pause`, {
          method: "POST",
          headers: {
            ...machineHeaders(token),
            "content-type": "application/json",
          },
          body: JSON.stringify({ paused }),
        }),
        "lecteur",
      ),

    seek: async (
      fileBase: string,
      token: string,
      to: number,
    ): Promise<MachinePlayerState> =>
      json(
        await fetch(`${fileBase}/player/seek`, {
          method: "POST",
          headers: {
            ...machineHeaders(token),
            "content-type": "application/json",
          },
          body: JSON.stringify({ to }),
        }),
        "lecteur",
      ),

    stop: async (fileBase: string, token: string): Promise<void> => {
      await fetch(`${fileBase}/player/stop`, {
        method: "POST",
        headers: machineHeaders(token),
      }).catch(() => {});
    },
  },

  /** La barre de commandes de cette machine, pour le seul verbe dont on ait besoin ici :
   *  `commit`, qui indexe, committe et pousse avec la clé de déploiement de la personne. */
  command: async (
    fileBase: string,
    token: string,
    workspace: string,
    line: string,
  ): Promise<string[]> => {
    const { output } = await json<{ output: string[] }>(
      await fetch(`${fileBase}/command`, {
        method: "POST",
        headers: {
          ...machineHeaders(token),
          [WORKSPACE_HEADER]: workspace,
          "content-type": "application/json",
        },
        body: JSON.stringify({ line }),
      }),
      "commande",
    );
    return output ?? [];
  },
};

/**
 * The engines this service knows about, and what it remembers about you.
 *
 * Its OWN registry, not l8's. Each hosted service holds one — see
 * packages/engine-registry/docs/shared.md — so an engine appears here only once it has been
 * pointed at the médiathèque too.
 *
 * The five routes, the probe, the policy and the lease all come from
 * @studio/engine-browser/access, bound to this service's prefix — "" here, since the
 * médiathèque answers the origin root. See that package's docs/access.md.
 *
 * Typed on `St0Prefs` because this service remembers more than an engine id — the preference
 * document is the host's, not the registry's. Nothing here should call `savePrefs` directly:
 * the route replaces wholesale, so `prefs.ts` owns the merge.
 */
export const engines = engineAccess<PublicEngine, St0Prefs>(BASE, json);

/** `/api/projects` rather than `/api/mediatek`, so it needs its own two verbs. */
const pget = async <T>(path: string, what: string): Promise<T> =>
  json(await fetch(`${BASE}/api/projects${path}`), what);
const psend = async <T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> =>
  json(
    await fetch(`${BASE}/api/projects${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
    path,
  );

/**
 * The user's git repositories — the Projets section.
 *
 * NOT the médiathèque: a repository belongs to a person, not to the volume, and this service
 * never makes a working copy of one. It keeps a bare blobless mirror to answer "what is in
 * there", and l8 does the actual checkout on the engine's machine. See ../../docs/projects.md.
 */
export const projects = {
  list: () => pget<{ repos: RepoSummary[]; revision: string }>("", "projects"),
  revision: () => pget<{ revision: string }>("/revision", "revision"),
  add: (uri: string, label?: string) =>
    psend<{ repo: RepoSummary }>("POST", "", { uri, label }),
  remove: (id: string) => psend<{ ok: true }>("DELETE", `/${id}`),
  refresh: (id: string) => psend<RepoStatus>("POST", `/${id}/refresh`),

  /**
   * The repository's tree. 202 means "known, but the mirror is still being fetched" — a
   * state of its own, and neither an error nor an empty repository, so it is returned rather
   * than thrown.
   */
  tree: async (
    id: string,
  ): Promise<{
    nodes: FileNode[];
    projects: { path: string; app: ProjectApp }[];
  } | null> => {
    const res = await fetch(`${BASE}/api/projects/${id}/tree`);
    if (res.status === 202) return null;
    return json(res, "tree");
  },

  sshKey: () => pget<SshKeyInfo>("/ssh-key", "ssh-key"),
  generateSshKey: () => psend<SshKeyInfo>("POST", "/ssh-key", {}),

  /**
   * Where a project opens — l8 or m9, whichever its folder name claims. Derived from the
   * page's own origin rather than declared: every studio service sits at a fixed path under
   * one origin, so dev and production differ by that origin and nothing else.
   *
   * A PATH, `/l8/<repo>/<project>`, and the repository by its short NAME. The editor asks us
   * back for the URI (`/api/projects/by-name/:name`), which keeps a host, a port and a user
   * out of an address bar that gets bookmarked and pasted.
   * See packages/project-shell/docs/launch.md.
   */
  openIn: (repoName: string, project: string, app: ProjectApp): string =>
    launchUrl(window.location.origin, repoName, project, app),
};

/** `/api/hunt`, its own prefix like the projects one, and for the same reason: it is not the
 *  médiathèque's volume that answers but a daemon on another machine. */
const hget = async <T>(path: string, what: string): Promise<T> =>
  json(await fetch(`${BASE}/api/hunt${path}`), what);

/**
 * Finding a song on the Soulseek network — the « Trouver des morceaux » screen.
 *
 * Starting one ANSWERS AT ONCE with the row: the work runs for minutes on the backend, and a
 * request held open for it would die on the first proxy timeout and take the search's only
 * handle with it. The screen polls this list instead, which is also what survives a reload.
 */
export const hunt = {
  list: () => hget<HuntList>("", "hunt"),

  /** `playlist` est figée sur la ligne au lancement : une recherche dure des minutes, et le
   *  menu de l'écran appartiendra alors à la suivante. */
  start: async (query: string, playlist?: string): Promise<HuntRecord> =>
    json(
      await fetch(`${BASE}/api/hunt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, playlist }),
      }),
      "hunt",
    ),

  /** Le secours, sur une ligne échouée : reprendre CETTE recherche par YouTube. La même ligne
   *  et pas une nouvelle — elle porte déjà les tags, donc le morceau se range au même endroit. */
  youtube: async (id: string): Promise<HuntRecord> =>
    json(
      await fetch(`${BASE}/api/hunt/${encodeURIComponent(id)}/youtube`, {
        method: "POST",
      }),
      "youtube",
    ),

  /** Cancels it if it is still running, and takes the row off the list either way. */
  forget: async (id: string): Promise<void> => {
    await json(
      await fetch(`${BASE}/api/hunt/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
      "hunt",
    );
  },
};

export const library = {
  summary: () =>
    get<{ present: boolean; counts: Record<string, number> }>("", "mediatek"),

  revisions: () =>
    get<{ present: boolean; revisions: Record<string, string> }>(
      "/revision",
      "revision",
    ),

  list: (family: string) =>
    get<FamilyListing>(`/list?family=${encodeURIComponent(family)}`, "list"),

  /** The library's own modules, as the refs a sibling's `extends:` may name — see
   *  moduleRefs.ts. A listing read for its NAMES only; the tree is drawn elsewhere. */
  baseModules: async (): Promise<string[]> =>
    mediatekModuleRefs((await library.list("modules")).entries),

  /**
   * Give every plugin a machine has scanned a module here — the face that lets a chain name it
   * and a panel be drawn for it.
   *
   * The scan travels in the REQUEST because it belongs to that machine and this backend is
   * hosted somewhere else. One call for the whole pass, not one write per plugin: two hundred
   * and fifty round-trips from a browser is a minute that can fail halfway. Idempotent — what
   * is already faced is skipped there, by ref.
   */
  addEngineFaces: async (
    plugins: FaceablePlugin[],
  ): Promise<{ created: string[]; scanned: number }> => {
    const res = await fetch(`${BASE}/api/mediatek/engine-faces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plugins }),
    });
    return json<{ created: string[]; scanned: number }>(res, "engine-faces");
  },

  /** A file's bytes, for an <audio>/<video> src. Served with Range, so seeking works. */
  fileUrl: (path: string) =>
    `${BASE}/api/mediatek/file?path=${encodeURIComponent(path)}`,

  /**
   * Does the library hold this file? One BYTE, not the file — the same `Range: bytes=0-0`
   * trick `cachedOnMachine` uses on the engine's side, for the same reason: asking costs a
   * request, and downloading a master to find out it is there costs the master.
   *
   * For what the catalogue cannot answer: a song's listing carries no file list (a song is a
   * folder the scan stops at), so a render written beside the master — `<variante>.mp3` — is
   * invisible to it. Any refusal reads as absent; the caller's next move is the same either way.
   */
  exists: async (path: string): Promise<boolean> => {
    try {
      const res = await fetch(library.fileUrl(path), {
        headers: { range: "bytes=0-0" },
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  /** One file's text. The library serves bytes; a module is YAML, so this reads it back. */
  readFile: async (
    path: string,
  ): Promise<{ path: string; content: string }> => {
    const res = await fetch(
      `${BASE}/api/mediatek/file?path=${encodeURIComponent(path)}`,
    );
    if (!res.ok) throw await failed(res, "file");
    return { path, content: await res.text() };
  },

  /**
   * A module's panel file — the `ui.yaml` in the module's own folder.
   *
   * The path is derived, not asked for, and the derivation is now `dirname`: the two files are
   * siblings (see `@studio/song`'s uiLibrary.ts). `modulePath` may name either of them, which is
   * what lets a click on the panel open the same builder. Absent is NOT an error — the editor is
   * told where it WOULD go and shown a blank grid, so the first save creates it through the
   * ordinary write route.
   */
  moduleUi: async (modulePath: string): Promise<ModuleUiFile> => {
    // modules/<type>/<name>/<file>.yaml -> modules/<type>/<name>/ui.yaml
    const parts = modulePath.split("/");
    const ref = parts.slice(1, -1).join("/");
    const path = [...parts.slice(0, -1), "ui.yaml"].join("/");
    try {
      const f = await library.readFile(path);
      return { ref, path, content: f.content, exists: true };
    } catch {
      return {
        ref,
        path,
        content: `# panel for ${ref}\ncols: 4\nrows: 2\nwidgets: {}\n`,
        exists: false,
      };
    }
  },

  /**
   * A module's DSP source — the `jsdsp.ts` in its own folder, for a `plugin: {type: jsdsp}`
   * module. Same derivation as the two sidecars, and absent is not an error for the same reason:
   * a module can declare the type before the source exists, and the first save creates it.
   */
  moduleJsDsp: async (modulePath: string): Promise<ModulePresetsFile> => {
    const parts = modulePath.split("/");
    const ref = parts.slice(1, -1).join("/");
    const path = [...parts.slice(0, -1), JSDSP_FILE].join("/");
    try {
      const f = await library.readFile(path);
      return { ref, path, content: f.content, exists: true };
    } catch {
      return {
        ref,
        path,
        // A stub that COMPILES, not an empty file: the loader runs this source to get the graph,
        // and a blank one fails on the first save rather than at some later, less obvious moment.
        content: `// ${ref} — the module's DSP. Export the graph the engine will host.\nexport default {};\n`,
        exists: false,
      };
    }
  },

  /**
   * A module's presets file — the `presets.yaml` in the module's own folder. Same derivation as
   * the panel above, and absent is not an error for the same reason.
   */
  modulePresets: async (modulePath: string): Promise<ModulePresetsFile> => {
    const parts = modulePath.split("/");
    const ref = parts.slice(1, -1).join("/");
    const path = [...parts.slice(0, -1), "presets.yaml"].join("/");
    try {
      const f = await library.readFile(path);
      return { ref, path, content: f.content, exists: true };
    } catch {
      return {
        ref,
        path,
        content: `# presets for ${ref}
`,
        exists: false,
      };
    }
  },

  /**
   * What the editor can complete against.
   *
   * A shadow of l8', and nearly empty: most of `Hints` describes a SONG — its tracks,
   * clips, chains — and a library has none of those. Parameter names used to come from here;
   * the engine reports them now (see engine/useModuleEngine), which is a better source anyway
   * — it is the loaded plugin talking rather than a table about it. The asset list went the
   * same way: a module's files live in its own `assets/`, so the builder reads them from the
   * module rather than from a project-wide list nobody here could fill.
   *
   * `baseModules` is the exception, and it is only HALF of that field: the médiathèque's own
   * modules, which a sibling may extend. The other half — what the engine provides, which is
   * what these files actually say — is asked of the machine over its socket, because this
   * backend serves a volume of files and has never seen a plugin scan. The builder merges the
   * two. See ../docs/completion.md.
   */
  hints: async (): Promise<Hints> => {
    return {
      baseModules: await library.baseModules().catch(() => []),
      ioSinks: [],
      modules: [],
      tracks: [],
      channels: [],
      clips: [],
      videoTracks: [],
      sequences: [],
      chains: [],
      moduleAssets: {},
      paramsByBase: {},
      paramMetaByBase: {},
      racks: {},
      keywords: [],
      pluginNames: {},
      paths: {},
      projectRoot: "",
      media: {},
    };
  },

  /** Drop OS files into `dir`. The File goes as the body: writeFile takes a string, which
   *  would corrupt every sample the moment one is dropped. */
  upload: async (dir: string, files: File[]): Promise<void> =>
    library.uploadTree(
      dir,
      files.map((file) => ({ path: file.name, file })),
    ),

  /**
   * Drop OS files into `dir`, FOLDERS INCLUDED — each carries the path it sat at.
   *
   * A module is a folder of three files now (`module.yaml`, `ui.yaml`, `presets.yaml`), so
   * "add a module" is a folder drop and a flat file list could not express it. The server
   * creates the intermediate directories (`putFile` in `@studio/mediatek/write`), so one PUT
   * per file is all this has to do; a path with a `..` in it is refused there, not here.
   */
  uploadTree: async (
    dir: string,
    files: { path: string; file: File }[],
  ): Promise<void> => {
    for (const { path: rel, file } of files) {
      const path = dir ? `${dir}/${rel}` : rel;
      const res = await fetch(
        `${BASE}/api/mediatek/file?path=${encodeURIComponent(path)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: file,
        },
      );
      if (!res.ok) throw await failed(res, `upload ${rel}:`);
    }
  },

  /**
   * The raw capture zone, day by day.
   *
   * Its own call and not a family listing: a capture enters no catalogue, so
   * `/list?family=songs` will never mention one. See packages/mediatek/docs/recordings.md.
   */
  recordings: () => get<{ days: RecordingDay[] }>("/recordings", "recordings"),

  /**
   * Push captures in, one request each.
   *
   * Every file carries its OWN moment — its mtime, which for a capture is when it was
   * recorded. A session dragged in the morning after would otherwise land under today,
   * whole, which is the one day it certainly does not belong to.
   */
  addRecordings: async (files: File[]): Promise<void> => {
    for (const file of files) {
      const q = new URLSearchParams({
        filename: file.name,
        at: new Date(file.lastModified).toISOString(),
      });
      const res = await fetch(`${BASE}/api/mediatek/recording?${q}`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw await failed(res, `${file.name}:`);
    }
  },

  /**
   * File one audio file as a song. The THREE TAGS go up, never a path: the library
   * derives `songs/<artiste>/<album>/<titre>/original.<ext>` itself. See
   * packages/mediatek/docs/songs.md.
   */
  addSong: async (
    file: File,
    tags: { artist: string; album: string; title: string },
    opts: { replace?: boolean } = {},
  ): Promise<{ path: string; master: string; replaced: boolean }> => {
    const q = new URLSearchParams({ filename: file.name, ...tags });
    if (opts.replace) q.set("replace", "1");
    const res = await fetch(`${BASE}/api/mediatek/song?${q}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as {
        error?: string;
        exists?: boolean;
      };
      // Told apart from every other refusal, because it is the one the UI can offer to
      // resolve rather than only report.
      if (res.status === 409) throw new SongExists(detail.error ?? "");
      throw new Error(detail.error ?? `song ${res.status}`);
    }
    return json(res, "song");
  },

  /**
   * One audio file as a VARIANT of a song that is already there — the bytes beside the
   * master, and the line in `song.yaml` that makes them one.
   *
   * Its own route rather than an `upload` into the folder, which is what the chain renderer
   * does: that one writes bytes the sidecar ALREADY names, and this one is what puts the name
   * there. Dropping a file in without it declares nothing, and the scan reads a song's
   * versions from the sidecar and from nowhere else.
   */
  addVariant: async (
    folder: string,
    file: File,
  ): Promise<{
    path: string;
    ref: string;
    name: string;
    declared: boolean;
  }> => {
    const q = new URLSearchParams({ path: folder, filename: file.name });
    const res = await fetch(`${BASE}/api/mediatek/variant?${q}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    });
    if (!res.ok) throw await failed(res, `${file.name}:`);
    return json(res, "variant");
  },

  remove: async (path: string): Promise<void> => {
    const res = await fetch(
      `${BASE}/api/mediatek/file?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    );
    if (!res.ok) throw await failed(res, "delete");
  },

  /** Move/rename — one server-side syscall, so it works on a folder and can never leave a
   *  duplicate. Replaced a read+write+delete dance that could do neither. */
  move: async (from: string, to: string): Promise<void> => {
    const res = await fetch(`${BASE}/api/mediatek/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, to }),
    });
    if (!res.ok) throw await failed(res, "move");
  },

  newFolder: async (path: string): Promise<void> => {
    const res = await fetch(`${BASE}/api/mediatek/folder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) throw await failed(res, "mkdir");
  },

  /** A whole subtree. Its own route, so removing a folder is never something a caller does
   *  by accident while meaning to remove one entry. */
  removeTree: async (path: string): Promise<void> => {
    const res = await fetch(
      `${BASE}/api/mediatek/folder?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    );
    if (!res.ok) throw await failed(res, "delete");
  },

  /** Write one file back. The library replaces — there is no fork, see docs/ingest.md. */
  writeFile: async (path: string, content: string): Promise<void> => {
    const res = await fetch(
      `${BASE}/api/mediatek/file?path=${encodeURIComponent(path)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: content,
      },
    );
    if (!res.ok) throw await failed(res, "write");
  },
};

/**
 * The shared builder's view of this backend (`@studio/ui-module-builder/store`).
 *
 * Four calls, all already here — the adapter is shapes, not behaviour. `write` never reports a
 * redirection because there is none to report: the library is one place, and the workspace a
 * copy used to land in is now somebody else's machine.
 */
export const moduleStore: ModuleStore = {
  // A file the library hasn't got is `null`, not a throw: a module folder with no module.yaml
  // yet is a real state here, and the builder opens on an empty buffer (see ModuleStore.read).
  read: async (path) => {
    try {
      return (await library.readFile(path)).content;
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  },
  moduleUi: (path) => library.moduleUi(path),
  presets: (path) => library.modulePresets(path),
  jsdsp: (path) => library.moduleJsDsp(path),
  hints: () => library.hints(),
  write: async (path, content) => {
    await library.writeFile(path, content);
    return {};
  },
};
