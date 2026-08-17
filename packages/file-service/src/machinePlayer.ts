// machinePlayer.ts — play a cached song through THIS machine's own outputs, without the
// moteur: one mpv per person, driven over its JSON IPC socket. For a headless box that is a
// player and not an instrument. See docs/machinePlayer.md.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import { mediatekRoot } from "@studio/song/mediatekRoot";
import { rootDir, slugify } from "./slug.ts";

/** `--ao=alsa` par défaut : sur une machine sans session graphique, PipeWire et PulseAudio ne
 *  démarrent pas tout seuls, et un lecteur dédié n'a pas besoin d'un serveur de son. */
const AO = process.env.STUDIO_PLAYER_AO || "alsa";

const bin = (): string => process.env.MPV_BIN || "mpv";

/** Une commande IPC qui n'a pas répondu au bout de ça est perdue : mpv répond en microsecondes
 *  sur un socket unix, donc au-delà c'est le processus qui est parti. */
const IPC_TIMEOUT_MS = 2000;

/** Ce que la barre du bas a besoin de savoir. */
export interface PlayerState {
  /** Le chemin relatif à la médiathèque qu'on a demandé, ou null si rien n'est chargé. */
  path: string | null;
  playing: boolean;
  /** Secondes, ou 0 tant que mpv n'a pas lu l'en-tête. */
  position: number;
  duration: number;
  /** mpv n'a plus rien à jouer — la fin d'un morceau, ou rien n'a jamais été chargé. */
  idle: boolean;
}

const EMPTY: PlayerState = {
  path: null,
  playing: false,
  position: 0,
  duration: 0,
  idle: true,
};

/**
 * Le chemin absolu d'un morceau de CETTE machine, à partir du chemin relatif demandé.
 *
 * Le client envoie du relatif et jamais de l'absolu, et c'est la garantie : il ne peut nommer
 * que ce que la médiathèque de cette machine contient. Un `..` est refusé plutôt que
 * normalisé — c'est une tentative, pas une faute de frappe, et la nommer vaut mieux que la
 * corriger en silence.
 */
export function resolveInMediatek(rel: string): string {
  if (!rel || isAbsolute(rel)) throw new Error("chemin relatif attendu");
  const root = mediatekRoot();
  const abs = normalize(join(root, rel));
  const inside = relative(root, abs);
  if (inside.startsWith("..") || isAbsolute(inside))
    throw new Error("chemin hors de la médiathèque");
  if (!existsSync(abs)) throw new Error(`${rel} n'est pas sur cette machine`);
  return abs;
}

interface Player {
  socketPath: string;
  /** Ce qu'on a demandé, que mpv ne sait pas rendre : il ne connaît que son chemin absolu. */
  wanted: string | null;
  ipc: Socket | null;
  nextId: number;
  pending: Map<number, (v: unknown) => void>;
  buffer: string;
}

const players = new Map<string, Player>();

const socketFor = (slug: string): string => {
  const dir = join(rootDir(), "mpv");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${slug}.sock`);
};

/** Ouvrir — ou rouvrir — la connexion IPC. Rendue `null` quand mpv n'est pas là : l'appelant
 *  le relance alors, ce qui est aussi ce qui se passe au tout premier appel. */
function dial(p: Player): Promise<Socket | null> {
  return new Promise((resolve) => {
    const s = connect(p.socketPath);
    const done = (v: Socket | null) => {
      s.removeAllListeners("connect");
      s.removeAllListeners("error");
      resolve(v);
    };
    s.once("connect", () => {
      p.buffer = "";
      // Une ligne = un message. mpv découpe sur `\n` et rien d'autre.
      s.on("data", (chunk) => {
        p.buffer += chunk.toString("utf8");
        for (;;) {
          const cut = p.buffer.indexOf("\n");
          if (cut < 0) break;
          const line = p.buffer.slice(0, cut);
          p.buffer = p.buffer.slice(cut + 1);
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line) as {
              request_id?: number;
              data?: unknown;
            };
            if (typeof msg.request_id === "number") {
              p.pending.get(msg.request_id)?.(msg.data);
              p.pending.delete(msg.request_id);
            }
            // Les événements sont ignorés : l'état est LU à la demande, ce qui évite d'avoir
            // à le tenir à jour des deux côtés du socket.
          } catch {
            /* une ligne illisible n'est pas une raison de fermer */
          }
        }
      });
      s.on("close", () => {
        p.ipc = null;
        // Personne ne répondra plus : libérer ceux qui attendent plutôt que les laisser
        // expirer un par un.
        for (const [, r] of p.pending) r(undefined);
        p.pending.clear();
      });
      s.on("error", () => s.destroy());
      done(s);
    });
    s.once("error", () => done(null));
  });
}

/** Lancer mpv, en veille : `--idle` le fait attendre un `loadfile` au lieu de sortir. */
function spawnMpv(p: Player): void {
  const child = spawn(
    bin(),
    [
      "--idle=yes",
      "--no-video",
      "--no-terminal",
      `--ao=${AO}`,
      // Pas de fichier de configuration ni de scripts de l'utilisateur : ce processus est un
      // organe de ce service, pas la session mpv de quelqu'un.
      "--no-config",
      `--input-ipc-server=${p.socketPath}`,
    ],
    { stdio: "ignore", detached: false },
  );
  child.on("error", () => {
    /* absent du PATH — `command()` le dira au prochain appel */
  });
  child.unref();
}

/** Attendre que le socket réponde, mpv le créant un instant après son démarrage. */
async function ensure(p: Player): Promise<Socket> {
  if (p.ipc && !p.ipc.destroyed) return p.ipc;
  let s = await dial(p);
  if (!s) {
    spawnMpv(p);
    for (let i = 0; i < 40 && !s; i++) {
      await new Promise((r) => setTimeout(r, 50));
      s = await dial(p);
    }
  }
  if (!s)
    throw new Error(
      `mpv n'a pas démarré sur cette machine (${bin()}) — est-il installé ?`,
    );
  p.ipc = s;
  return s;
}

function playerFor(userEmail: string): Player {
  const slug = slugify(userEmail);
  let p = players.get(slug);
  if (!p) {
    p = {
      socketPath: socketFor(slug),
      wanted: null,
      ipc: null,
      nextId: 1,
      pending: new Map(),
      buffer: "",
    };
    players.set(slug, p);
  }
  return p;
}

/** Une commande, et sa réponse. `undefined` quand mpv n'a rien à dire — une propriété absente
 *  n'est pas une erreur, c'est « pas encore ». */
async function command(p: Player, args: unknown[]): Promise<unknown> {
  const s = await ensure(p);
  const id = p.nextId++;
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      p.pending.delete(id);
      resolve(undefined);
    }, IPC_TIMEOUT_MS);
    p.pending.set(id, (v) => {
      clearTimeout(t);
      resolve(v);
    });
    s.write(`${JSON.stringify({ command: args, request_id: id })}\n`);
  });
}

const get = (p: Player, name: string): Promise<unknown> =>
  command(p, ["get_property", name]);

/** Est-ce que mpv existe seulement sur cette machine ? Sondé à la demande, comme yt-dlp. */
export async function playerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(bin(), ["--version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

export async function play(
  userEmail: string,
  rel: string,
  from = 0,
): Promise<void> {
  const abs = resolveInMediatek(rel);
  const p = playerFor(userEmail);
  // `replace` et non `append` : une seule chose sort des haut-parleurs, comme partout ailleurs
  // dans st0 — la file d'attente vit dans l'onglet, pas ici.
  await command(p, [
    "loadfile",
    abs,
    "replace",
    // mpv accepte les options de départ dans le même appel, ce qui évite un seek qui
    // s'appliquerait avant que le fichier soit ouvert.
    from > 0 ? { start: String(from) } : {},
  ]);
  await command(p, ["set_property", "pause", false]);
  p.wanted = rel;
}

export async function setPaused(
  userEmail: string,
  paused: boolean,
): Promise<void> {
  await command(playerFor(userEmail), ["set_property", "pause", paused]);
}

export async function seek(userEmail: string, to: number): Promise<void> {
  await command(playerFor(userEmail), [
    "set_property",
    "time-pos",
    Math.max(0, to),
  ]);
}

/** Arrêter et oublier. mpv reste en veille : le relancer coûte un démarrage de processus à
 *  chaque morceau, pour rien. */
export async function stop(userEmail: string): Promise<void> {
  const p = playerFor(userEmail);
  await command(p, ["stop"]);
  p.wanted = null;
}

export async function state(userEmail: string): Promise<PlayerState> {
  const p = playerFor(userEmail);
  if (!p.ipc && !existsSync(p.socketPath)) return EMPTY;
  // Toutes en même temps sur le même socket : mpv n'a pas de commande groupée, mais rien
  // n'oblige à les enchaîner — c'est un aller-retour et non cinq.
  const [idle, paused, pos, dur] = await Promise.all([
    get(p, "idle-active"),
    get(p, "pause"),
    get(p, "time-pos"),
    get(p, "duration"),
  ]);
  const isIdle = idle !== false;
  return {
    // Ce qu'on a DEMANDÉ : mpv ne connaît que le chemin absolu, et le rendre exposerait
    // l'arborescence de la machine à un client qui n'en a pas besoin.
    path: isIdle ? null : p.wanted,
    playing: !isIdle && paused === false && typeof pos === "number",
    position: typeof pos === "number" ? pos : 0,
    duration: typeof dur === "number" ? dur : 0,
    idle: isIdle,
  };
}

/** Exporté pour le test du garde-fou, qui n'a pas à connaître `sep`. */
export const PATH_SEP = sep;
