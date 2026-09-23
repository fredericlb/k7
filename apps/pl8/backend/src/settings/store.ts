// store.ts — one person's slskd settings, a file per person on the library volume under a
// dot-directory, like the hunts they drive. The secrets are sealed in the file and never leave
// this module except to the hunt that spends them. See ../../docs/settings.md.

import { join } from "node:path";
import { mediatekDir } from "@studio/mediatek/layout";
import { prefsStore } from "@studio/user-prefs";
import type {
  SlskdSettings,
  SlskdSettingsInput,
} from "@studio/web-protocol/settings";
import type { SftpConfig } from "../hunt/sftp.ts";
import type { SlskdConfig } from "../hunt/slskd.ts";
import { seal, unseal } from "./secret.ts";

/** On disk: the plain fields as typed, each secret sealed or absent. */
interface Stored {
  url?: string;
  sftpHost?: string;
  sftpPort?: number;
  sftpUser?: string;
  downloadsDir?: string;
  apiKey?: string;
  sftpPassword?: string;
  sftpKey?: string;
  sftpPassphrase?: string;
}

const SECRETS = [
  "apiKey",
  "sftpPassword",
  "sftpKey",
  "sftpPassphrase",
] as const;

/** Under a dot-directory: `writablePath` refuses those and `revision.ts` does not walk them. */
export function settingsDir(): string {
  return process.env.STUDIO_SETTINGS_DIR || join(mediatekDir(), ".settings");
}

// Rebuilt per call, since the directory is read from process.env and a test moves it.
const store = () => prefsStore<Stored>(settingsDir());

const read = (sub: string): Stored => store().read(sub) ?? {};

/** A secret that no longer opens — the session secret changed — counts as none on file. */
function open(sealed: string | undefined): string {
  if (!sealed) return "";
  try {
    return unseal(sealed);
  } catch {
    return "";
  }
}

export function readSettings(sub: string): SlskdSettings {
  const s = read(sub);
  return {
    url: s.url ?? "",
    sftpHost: s.sftpHost ?? "",
    sftpPort: s.sftpPort ?? 22,
    sftpUser: s.sftpUser ?? "",
    downloadsDir: s.downloadsDir ?? "",
    hasApiKey: Boolean(open(s.apiKey)),
    hasSftpPassword: Boolean(open(s.sftpPassword)),
    hasSftpKey: Boolean(open(s.sftpKey)),
    hasSftpPassphrase: Boolean(open(s.sftpPassphrase)),
  };
}

/** The plain fields replace what is there; a secret left out is kept, an empty one forgotten. */
export function saveSettings(sub: string, input: SlskdSettingsInput): void {
  const prev = read(sub);
  const next: Stored = {
    url: input.url.trim().replace(/\/+$/, ""),
    sftpHost: input.sftpHost.trim(),
    sftpPort: input.sftpPort,
    sftpUser: input.sftpUser.trim(),
    downloadsDir: input.downloadsDir.trim().replace(/(.)\/+$/, "$1"),
  };
  for (const k of SECRETS) {
    const typed = input[k];
    if (typed === undefined) next[k] = prev[k];
    else if (typed) next[k] = seal(typed);
  }
  if (!store().write(sub, next))
    throw new Error("les paramètres n'ont pas pu être enregistrés");
}

/** The daemon's half, or null while its address or key is missing. */
export function slskdOf(sub: string): SlskdConfig | null {
  const s = read(sub);
  const key = open(s.apiKey);
  return s.url && key ? { url: s.url, key } : null;
}

/** The SFTP half, or null while the host, user or folder is missing. */
export function sftpOf(sub: string): SftpConfig | null {
  const s = read(sub);
  if (!s.sftpHost || !s.sftpUser || !s.downloadsDir) return null;
  return {
    host: s.sftpHost,
    port: s.sftpPort ?? 22,
    username: s.sftpUser,
    password: open(s.sftpPassword) || undefined,
    privateKey: open(s.sftpKey) || undefined,
    passphrase: open(s.sftpPassphrase) || undefined,
    downloadsDir: s.downloadsDir,
  };
}

/** What is missing, in the words of the settings screen — null when a hunt can run. */
export function missing(sub: string): string | null {
  const gaps: string[] = [];
  if (!slskdOf(sub)) gaps.push("l'adresse de slskd et sa clé API");
  if (!sftpOf(sub))
    gaps.push("l'hôte SFTP, son utilisateur et le dossier de téléchargement");
  return gaps.length
    ? `à renseigner dans les paramètres : ${gaps.join(", ")}`
    : null;
}
