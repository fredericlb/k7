// One row per user in the SupernoteSync table: where their private cloud is, who to sign
// in as, and what the last run did. The password is the only sealed column — ../../../docs/supernote.md.

import { addRecords, listRecords, patchRecord } from "../pocketbase.ts";
import { seal, unseal } from "./secret.ts";

const TABLE = "SupernoteSync";

/** What the settings screen may see: everything but the password. */
export interface SyncStatus {
  enabled: boolean;
  baseUrl: string;
  account: string;
  /** A password is on file, so the sync can run unattended. */
  activated: boolean;
  lastSyncAt: string;
  lastStatus: string;
  lastCount: number;
}

export interface Credentials {
  baseUrl: string;
  account: string;
  password: string;
}

async function rowOf(ownerId: string) {
  const [row] = await listRecords(TABLE, { OwnerId: [ownerId] });
  return row ?? null;
}

export async function readStatus(ownerId: string): Promise<SyncStatus> {
  const row = await rowOf(ownerId);
  const f = row?.fields ?? {};
  return {
    enabled: Boolean(f.Enabled),
    baseUrl: String(f.BaseUrl || ""),
    account: String(f.Account || ""),
    activated: Boolean(f.Secret),
    lastSyncAt: String(f.LastSyncAt || ""),
    lastStatus: String(f.LastStatus || ""),
    lastCount: Number(f.LastCount || 0),
  };
}

export async function readCredentials(
  ownerId: string,
): Promise<Credentials | null> {
  const row = await rowOf(ownerId);
  const f = row?.fields;
  if (!f?.Secret || !f.BaseUrl || !f.Account) return null;
  return {
    baseUrl: String(f.BaseUrl),
    account: String(f.Account),
    password: unseal(String(f.Secret)),
  };
}

/** What the songbook looked like at the last push: song uid -> a hash of its text. */
export async function readPushed(
  ownerId: string,
): Promise<Record<string, string>> {
  const row = await rowOf(ownerId);
  try {
    return JSON.parse(String(row?.fields?.Pushed || "{}"));
  } catch {
    return {};
  }
}

async function write(ownerId: string, fields: Record<string, unknown>) {
  const row = await rowOf(ownerId);
  if (row) await patchRecord(TABLE, row.id, fields);
  else await addRecords(TABLE, [{ OwnerId: ownerId, ...fields }]);
}

/** Activation: the address, the account, and a password only if one was typed. */
export async function saveConfig(
  ownerId: string,
  input: {
    enabled: boolean;
    baseUrl: string;
    account: string;
    password?: string;
  },
): Promise<void> {
  await write(ownerId, {
    Enabled: input.enabled,
    BaseUrl: input.baseUrl.replace(/\/+$/, ""),
    Account: input.account,
    ...(input.password ? { Secret: seal(input.password) } : {}),
  });
}

/** Switching off keeps the address and the account, and forgets the password. */
export async function disable(ownerId: string): Promise<void> {
  await write(ownerId, { Enabled: false, Secret: "" });
}

export async function markRun(
  ownerId: string,
  run: { status: string; count: number; pushed?: Record<string, string> },
): Promise<void> {
  await write(ownerId, {
    LastSyncAt: new Date().toISOString(),
    LastStatus: run.status,
    LastCount: run.count,
    ...(run.pushed ? { Pushed: JSON.stringify(run.pushed) } : {}),
  });
}

/** Everyone the hourly run has to visit. */
export async function enabledOwners(): Promise<string[]> {
  const rows = await listRecords(TABLE, {});
  return rows
    .filter((r) => r.fields.Enabled && r.fields.Secret)
    .map((r) => String(r.fields.OwnerId));
}
