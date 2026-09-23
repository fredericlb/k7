// settings.ts — what pl8's settings screen and its backend agree on: the slskd connection a
// person's hunts run through. The secrets go in and never come back out, only whether one is
// on file. See apps/pl8/docs/settings.md.

/** What `GET /api/settings/slskd` answers — every field but the secrets. */
export interface SlskdSettings {
  /** The daemon's address, e.g. `https://slskd.lan:5031`. */
  url: string;
  sftpHost: string;
  sftpPort: number;
  sftpUser: string;
  /** Where slskd drops a finished download, as ITS machine sees it. */
  downloadsDir: string;
  hasApiKey: boolean;
  hasSftpPassword: boolean;
  hasSftpKey: boolean;
  hasSftpPassphrase: boolean;
}

/** What `PUT` takes: a secret left out keeps the one on file, an empty string forgets it. */
export interface SlskdSettingsInput {
  url: string;
  sftpHost: string;
  sftpPort: number;
  sftpUser: string;
  downloadsDir: string;
  apiKey?: string;
  sftpPassword?: string;
  sftpKey?: string;
  sftpPassphrase?: string;
}

/** One half of a connection test: `detail` is the error, or what was seen on success. */
export interface CheckResult {
  ok: boolean;
  detail: string;
}

/** What `POST /api/settings/slskd/check` answers — both halves, since each fails on its own. */
export interface SlskdCheck {
  slskd: CheckResult;
  sftp: CheckResult;
}
