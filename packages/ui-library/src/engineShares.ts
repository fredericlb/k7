// engineShares.ts — whose an engine is, as the Engines card says it, and the owner's routes to
// share it or give it up (packages/engine-registry/docs/ownership.md). The parsing mirrors the
// server's `cleanShares`, which stays the one that decides: this only says it before a round trip.

import type { PublicEngine } from "@studio/web-protocol";
import { hostBase } from "./config";
import type { LibraryLabels } from "./labels";

const EMAIL = /^[^\s@]+@[^\s@]+$/;

/** The share list as typed — commas, spaces or lines between — cleaned, or the first entry that is not an email. */
export function parseShares(
  text: string,
): { ok: true; emails: string[] } | { ok: false; bad: string } {
  const emails: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const e = raw.trim().toLowerCase();
    if (!e) continue;
    if (e.length > 254 || !EMAIL.test(e)) return { ok: false, bad: raw };
    if (!emails.includes(e)) emails.push(e);
  }
  return { ok: true, emails };
}

/** The badge that says what this account is to the engine, or null from a registry that does not say. */
export function accessLabel(
  e: Pick<PublicEngine, "access" | "ownedBy">,
  l: LibraryLabels["engines"],
): string | null {
  switch (e.access) {
    case "owner":
      return l.yours;
    case "shared":
      return l.sharedBy(e.ownedBy || l.someone);
    case "server":
      return l.server;
    case "unowned":
      return l.unowned;
    default:
      return null;
  }
}

/** The owner's view of one engine's shares. */
export interface EngineShares {
  owner: string;
  shared: string[];
  /** Shared with every signed-in account of this server. */
  everyone: boolean;
  since: number;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${hostBase()}/api/engines/${path}`, {
    credentials: "include",
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  // The status rides along: a 403 from the admins' route is a card to hide, not an error to show.
  if (!res.ok)
    throw Object.assign(new Error(body.error ?? `engines ${res.status}`), {
      status: res.status,
    });
  return body;
}

/** The owner's three calls; every other account is answered 404, as if the engine had no owner. */
export const engineShares = {
  load: (id: string) => call<EngineShares>(`${encodeURIComponent(id)}/shares`),
  save: (id: string, emails: string[], everyone: boolean) =>
    call<{ ok: true; shared: string[]; everyone: boolean }>(
      `${encodeURIComponent(id)}/shares`,
      { method: "PUT", body: JSON.stringify({ emails, everyone }) },
    ),
  giveUp: (id: string) =>
    call<{ ok: true }>(`${encodeURIComponent(id)}/owner`, {
      method: "DELETE",
    }),
};

/** One owned engine as an admin reads it: the record, its machine's name, whether it beats now. */
export interface EngineOwnerRecord extends EngineShares {
  id: string;
  hostname: string | null;
  online: boolean;
}

/** The admins' two calls; anyone else is answered 403 on the list. */
export const engineOwners = {
  list: () => call<EngineOwnerRecord[]>("owners"),
  reset: (id: string) => engineShares.giveUp(id),
};
