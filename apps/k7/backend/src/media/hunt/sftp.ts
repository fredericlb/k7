// sftp.ts — the bytes. slskd's API can list a completed download and delete it but has no
// route that serves one, so the file crosses the network over SFTP, PULLED by this server rather than
// pushed by the other machine. See ../../../docs/media/hunt.md.

import { isPlainSegment } from "@studio/web-protocol/paths";

/** The library's own upload route stops here, so anything past it is a transfer spent on nothing. */
const MAX_BYTES = 512 * 1024 * 1024;

/** How deep to look for a file slskd did not file where documented — more would be a crawl. */
const SEARCH_DEPTH = 3;

/** One file's transfer, once connected: a stalled session would otherwise hold a hunt's slot until a restart. */
const GET_MS = 20 * 60_000;

/** `p`, or the error `giveUp` builds once `ms` has passed. */
function within<T>(p: Promise<T>, ms: number, giveUp: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(giveUp()), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/** One person's, from ../settings/store.ts — the key is the key ITSELF, never a path. */
export interface SftpConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  downloadsDir: string;
}

/** Where slskd will have put a download — two segments, `.` and `..` dropped; ../../../docs/media/hunt.md. */
export function localPathFor(remote: string, downloadsDir: string): string {
  const parts = remote.split(/[\\/]/).filter(isPlainSegment);
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

/** A client, its module loaded on first use: ssh2 costs every start its evaluation, and few accounts ever hunt. */
type MakeClient = () => SftpLike | Promise<SftpLike>;
const newClient: MakeClient = async () => {
  const { default: SftpClient } = await import("ssh2-sftp-client");
  return new SftpClient() as unknown as SftpLike;
};

/** The options `connect` takes, the same for a download and for the settings screen's test. */
const connectOptions = (cfg: SftpConfig) => ({
  host: cfg.host,
  port: cfg.port,
  username: cfg.username,
  password: cfg.password,
  privateKey: cfg.privateKey,
  passphrase: cfg.passphrase,
  readyTimeout: 20_000,
});

/** Always, not only on failure — this is where two machines meet; see ../../../docs/media/hunt.md. */
const log = (msg: string): void => console.log(`⇣ sftp ${msg}`);

/** How many entries to print: a log line of ten thousand names is not a log line. */
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

/** By name, when it is not where the layout says — slskd's placement is configurable. */
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
      // Every level is printed: the only way to see WHERE slskd actually filed it.
      log(`descente dans ${dir}/${r.name}`);
      await show(sftp, `${dir}/${r.name}`);
      const hit = await findByName(sftp, `${dir}/${r.name}`, name, depth - 1);
      if (hit) return hit;
    }
  return null;
}

/** Fetch a completed download: connect, take the one file, close — never a pool. */
export async function fetchDownload(
  cfg: SftpConfig,
  remoteFilename: string,
  make: MakeClient = newClient,
): Promise<{ bytes: Buffer; path: string }> {
  const sftp = await make();
  // BEFORE connecting, since a `connect` exception carries none of it. Never the key itself.
  log(
    `→ ${cfg.username}@${cfg.host}:${cfg.port} (${cfg.privateKey ? "clé" : cfg.password ? "mot de passe" : "sans identifiant !"})`,
  );
  try {
    await sftp.connect(connectOptions(cfg));
    log(`connecté, dossier ${cfg.downloadsDir}`);
    // Both ends side by side: what the PEER named, and what is deduced from it on THIS machine.
    log(`nom chez le pair : ${remoteFilename}`);
    const guess = localPathFor(remoteFilename, cfg.downloadsDir);
    log(`chemin visé      : ${guess}`);
    await show(sftp, cfg.downloadsDir);

    // `exists` throws as readily as it answers false, and both mean "not where expected".
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
    const got = await within(sftp.get(path), GET_MS, () => {
      void sftp.end().catch(() => {});
      return new Error(`${path} : transfert SFTP bloqué, abandonné`);
    });
    if (!Buffer.isBuffer(got))
      throw new Error(`${path} : réponse SFTP inattendue`);
    if (got.length > MAX_BYTES)
      throw new Error(
        `${path} : ${Math.round(got.length / 1024 / 1024)} Mo, au-delà de ce que la médiathèque accepte`,
      );
    log(`${(got.length / 1024 / 1024).toFixed(1)} Mo lus depuis ${path}`);
    return { bytes: got, path };
  } finally {
    // Always, throw included: a failed hunt would otherwise leak a session on the other machine.
    await sftp.end().catch(() => {});
  }
}

/** The settings screen's test: sign in and look at the download folder, then hang up. */
export async function checkSftp(
  cfg: SftpConfig,
  make: MakeClient = newClient,
): Promise<string> {
  const sftp = await make();
  try {
    await sftp.connect(connectOptions(cfg));
    const rows = await sftp.list(cfg.downloadsDir);
    return `${cfg.downloadsDir} : ${rows.length} entrée(s)`;
  } finally {
    await sftp.end().catch(() => {});
  }
}
