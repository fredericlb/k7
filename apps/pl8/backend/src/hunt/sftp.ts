// sftp.ts — the bytes. slskd's API can list a completed download and delete it but has no
// route that serves one, so the file crosses the network over SFTP, PULLED by pl8 rather than
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
 * What this step saw and what it tried, in the service's logs.
 *
 * Always, not only on failure: this is where two machines meet, and the two questions asked when
 * nothing arrives — what is actually in that folder, and which path was tried — can only be
 * answered while the answers are still to hand. A download lasts minutes; a few lines per
 * download are not noise.
 */
const log = (msg: string): void => console.log(`⇣ sftp ${msg}`);

/** How many directory entries to print. A download folder can hold thousands, and a log line of
 *  ten thousand names is not a log line. */
const MAX_LISTED = 40;

/** A directory's contents as they are, with the type — `d` folder, `-` file. */
async function show(sftp: SftpLike, dir: string): Promise<number> {
  let rows: { name: string; type: string }[];
  try {
    rows = await sftp.list(dir);
  } catch (e) {
    // Unreadable is a fact, not an incident — a wrong path, or rights the SSH user lacks.
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
      // Every level descended is printed: the only way to see WHERE slskd filed it, when that is
      // not where the documented layout said.
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
  // BEFORE connecting: if the connection is what fails, these are the values to re-read, and a
  // `connect` exception does not carry them. Neither the key nor the password, obviously.
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
    // Both ends of the reasoning, side by side: what the PEER named, and what is deduced from it
    // on THIS machine. With both in the log, an unexpected slskd layout reads at a glance instead
    // of being worked out.
    log(`nom chez le pair : ${remoteFilename}`);
    const guess = localPathFor(remoteFilename, cfg.downloadsDir);
    log(`chemin visé      : ${guess}`);
    await show(sftp, cfg.downloadsDir);

    // `exists` can throw as easily as answer false — a missing folder, missing rights — and both
    // mean the same thing here: not where it was expected.
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
