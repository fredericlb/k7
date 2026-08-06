// sftp.ts — the bytes. slskd's API can list a completed download and delete it but has no
// route that serves one, so the file crosses the network over SFTP, PULLED by st0 rather than
// pushed by the other machine. See ../../docs/hunt.md.

import SftpClient from "ssh2-sftp-client";

/** The library's own upload route stops at 512 MB; a download it could not then file would be
 *  an hour of transfer spent on nothing. */
const MAX_BYTES = 512 * 1024 * 1024;

/** How deep to look for a file slskd did not put where we expected. Two is the shape it
 *  documents (`<downloads>/<album folder>/<file>`); more would be a directory crawl. */
const SEARCH_DEPTH = 3;

export interface SftpConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  downloadsDir: string;
}

/** Read per call, like `slskdConfig` and for the same reason: `env.yaml` is layered into
 *  `process.env` at boot, after this module is loaded. */
export function sftpConfig(): SftpConfig {
  const host = process.env.SLSKD_SFTP_HOST || "";
  const username = process.env.SLSKD_SFTP_USER || "";
  const downloadsDir = process.env.SLSKD_DOWNLOADS_DIR || "";
  if (!host || !username || !downloadsDir)
    throw new Error(
      "le SFTP n'est pas configuré : il faut SLSKD_SFTP_HOST, SLSKD_SFTP_USER et SLSKD_DOWNLOADS_DIR",
    );
  return {
    host,
    port: Number(process.env.SLSKD_SFTP_PORT || 22),
    username,
    password: process.env.SLSKD_SFTP_PASSWORD || undefined,
    // The key ITSELF, not a path: this service already keeps its git identity as bytes it
    // holds rather than a file on disk, and a container gets its secrets as environment.
    privateKey: process.env.SLSKD_SFTP_KEY || undefined,
    passphrase: process.env.SLSKD_SFTP_PASSPHRASE || undefined,
    downloadsDir: downloadsDir.replace(/\/+$/, ""),
  };
}

export function sftpConfigured(): boolean {
  return Boolean(
    process.env.SLSKD_SFTP_HOST &&
      process.env.SLSKD_SFTP_USER &&
      process.env.SLSKD_DOWNLOADS_DIR,
  );
}

/**
 * Where slskd will have put a download, from the path the PEER used.
 *
 * slskd files `@bob\Music\Nirvana\Nevermind\05 Lithium.flac` as
 * `<downloads>/Nevermind/05 Lithium.flac` — the containing folder and the name, nothing above.
 *
 * The two segments are taken after `.` and `..` have been dropped, so whatever the remote path
 * says the result is always UNDER the downloads directory. That is not a formality: this string
 * comes off the Soulseek network, where a file name is whatever a stranger typed, and slskd's
 * own documentation warns that these values are hostile.
 */
export function localPathFor(remote: string, downloadsDir: string): string {
  const parts = remote
    .split(/[\\/]/)
    .filter((p) => p && p !== "." && p !== "..");
  const name = parts[parts.length - 1] ?? "";
  const dir = parts.length >= 2 ? parts[parts.length - 2] : "";
  return [downloadsDir.replace(/\/+$/, ""), dir, name]
    .filter(Boolean)
    .join("/");
}

/** The file's own name, which is what a fallback search looks for. */
export function baseName(remote: string): string {
  const parts = remote.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/** Anything with a `connect`/`get`/`end`, so a test — or another transport — can stand in. */
export interface SftpLike {
  connect(config: Record<string, unknown>): Promise<unknown>;
  get(remote: string): Promise<string | Buffer | NodeJS.WritableStream>;
  exists(remote: string): Promise<false | "d" | "-" | "l">;
  list(remote: string): Promise<{ name: string; type: string; size: number }[]>;
  end(): Promise<unknown>;
}

/**
 * Ce que cette étape a vu et ce qu'elle a tenté, dans les journaux du service.
 *
 * Toujours, pas seulement en cas d'échec : c'est ici que deux machines se rencontrent, et les
 * deux questions qu'on se pose quand rien n'arrive — « qu'y a-t-il vraiment dans ce dossier »
 * et « quel chemin as-tu essayé » — ne peuvent être répondues qu'au moment où on les a sous la
 * main. Un téléchargement dure des minutes ; quelques lignes par téléchargement ne sont pas du
 * bruit.
 */
const log = (msg: string): void => console.log(`⇣ sftp ${msg}`);

/** Combien d'entrées d'un répertoire écrire. Un dossier de téléchargement peut en tenir des
 *  milliers, et une ligne de journal de dix mille noms n'est plus une ligne de journal. */
const MAX_LISTED = 40;

/** Le contenu d'un répertoire, tel quel, avec son type — `d` dossier, `-` fichier. */
async function show(sftp: SftpLike, dir: string): Promise<number> {
  let rows: { name: string; type: string }[];
  try {
    rows = await sftp.list(dir);
  } catch (e) {
    // Illisible est un fait, pas un incident : mauvais chemin, ou droits qui manquent à
    // l'utilisateur SSH. Le dire ici évite de chercher du côté de slskd.
    log(`${dir} : ILLISIBLE — ${(e as Error).message}`);
    return 0;
  }
  const shown = rows
    .slice(0, MAX_LISTED)
    .map((r) => `[${r.type}] ${r.name}`)
    .join(", ");
  const rest =
    rows.length > MAX_LISTED ? ` … +${rows.length - MAX_LISTED}` : "";
  log(`${dir} : ${rows.length} entrée(s) → ${shown}${rest}`);
  return rows.length;
}

/** Look for the file by name when it is not where the layout says. slskd can be configured to
 *  place downloads differently, and a hunt that failed for THAT would be indistinguishable
 *  from one nobody would seed. */
async function findByName(
  sftp: SftpLike,
  dir: string,
  name: string,
  depth: number,
): Promise<string | null> {
  if (depth < 0) return null;
  let rows: { name: string; type: string }[];
  try {
    rows = await sftp.list(dir);
  } catch {
    return null;
  }
  for (const r of rows)
    if (r.type === "-" && r.name === name) return `${dir}/${r.name}`;
  for (const r of rows)
    if (r.type === "d") {
      // Chaque niveau descendu est écrit : c'est la seule façon de voir OÙ slskd a rangé,
      // quand ce n'est pas là où la mise en page documentée le disait.
      log(`descente dans ${dir}/${r.name}`);
      await show(sftp, `${dir}/${r.name}`);
      const hit = await findByName(sftp, `${dir}/${r.name}`, name, depth - 1);
      if (hit) return hit;
    }
  return null;
}

/**
 * Fetch a completed download off the slskd machine.
 *
 * Opens a connection, takes the one file, closes. Not a pool: a hunt fetches once, minutes
 * after the last one, and a connection held open across that would be a socket to keep alive
 * for nothing.
 */
export async function fetchDownload(
  remoteFilename: string,
  make: () => SftpLike = () => new SftpClient() as unknown as SftpLike,
): Promise<{ bytes: Buffer; path: string }> {
  const cfg = sftpConfig();
  const sftp = make();
  // AVANT la connexion : si c'est elle qui échoue, ce sont ces valeurs-là qu'on veut relire,
  // et une exception de `connect` ne les porte pas. Ni la clé ni le mot de passe, évidemment.
  log(
    `→ ${cfg.username}@${cfg.host}:${cfg.port} (${cfg.privateKey ? "clé" : cfg.password ? "mot de passe" : "sans identifiant !"})`,
  );
  try {
    await sftp.connect({
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      password: cfg.password,
      privateKey: cfg.privateKey,
      passphrase: cfg.passphrase,
      readyTimeout: 20_000,
    });
    log(`connecté, dossier ${cfg.downloadsDir}`);
    // Les deux bouts du raisonnement, côte à côte : ce que le PAIR a nommé, et ce qu'on en
    // déduit sur CETTE machine. Quand les deux sont dans le journal, un rangement inattendu
    // de slskd se lit d'un coup d'œil au lieu de se déduire.
    log(`nom chez le pair : ${remoteFilename}`);
    const guess = localPathFor(remoteFilename, cfg.downloadsDir);
    log(`chemin visé      : ${guess}`);
    await show(sftp, cfg.downloadsDir);

    // `exists` peut lever autant que répondre faux — un dossier absent, des droits qui
    // manquent — et les deux veulent dire la même chose ici : « pas là où on l'attendait ».
    const kind = await sftp.exists(guess).catch(() => false as const);
    let path: string | null = null;
    if (kind === "-") {
      log("trouvé à l'endroit attendu");
      path = guess;
    } else {
      log(
        `pas à l'endroit attendu (${kind === false ? "absent" : `type « ${kind} »`}) — recherche par nom sur ${SEARCH_DEPTH} niveaux`,
      );
      path = await findByName(
        sftp,
        cfg.downloadsDir,
        baseName(remoteFilename),
        SEARCH_DEPTH,
      );
      if (path) log(`trouvé ailleurs  : ${path}`);
    }
    if (!path) {
      console.warn(
        `⇣ sftp ÉCHEC : « ${baseName(remoteFilename)} » introuvable sous ${cfg.downloadsDir} sur ${cfg.host}`,
      );
      throw new Error(
        `téléchargé, mais introuvable sur ${cfg.host} sous ${cfg.downloadsDir}`,
      );
    }
    const got = await sftp.get(path);
    if (!Buffer.isBuffer(got))
      throw new Error(`${path} : réponse SFTP inattendue`);
    if (got.length > MAX_BYTES)
      throw new Error(
        `${path} : ${Math.round(got.length / 1024 / 1024)} Mo, au-delà de ce que la médiathèque accepte`,
      );
    log(`${(got.length / 1024 / 1024).toFixed(1)} Mo lus depuis ${path}`);
    return { bytes: got, path };
  } finally {
    // Always, including after a throw: a connection left open would hold a session on the
    // other machine until its own timeout, and a hunt that failed would leak one each time.
    await sftp.end().catch(() => {});
  }
}
