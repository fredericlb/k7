// slskd.ts — the search-and-enqueue half of a hunt, spoken to a slskd daemon that lives on
// another machine. Every call carries the API key and a bounded timeout; nothing here reads
// the network's answers as anything but data. See ../../../docs/media/hunt.md.

import { randomUUID } from "node:crypto";
import type { SlskdResponse } from "./rank.ts";

/** One download, as slskd reports it. `state` is a comma-joined flags enum — see `classify`. */
export interface Transfer {
  id: string;
  filename: string;
  state: string;
  size?: number;
  bytesTransferred?: number;
  percentComplete?: number;
}

const TIMEOUT_MS = 15_000;

/** Where the daemon is and the key it takes — one person's, from ../settings/store.ts. */
export interface SlskdConfig {
  url: string;
  key: string;
}

async function call<T>(
  { url, key }: SlskdConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${url}/api/v0${path}`, {
    ...init,
    headers: {
      "x-api-key": key,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    // Trimmed: slskd answers an error with a page, and a whole one in a log line buries it.
    const body = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(
      `slskd ${res.status} sur ${path}${body ? ` : ${body}` : ""}`,
    );
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Start a search. The id is OURS — slskd takes a GUID — so a caller can poll at once. */
export async function startSearch(
  cfg: SlskdConfig,
  text: string,
): Promise<string> {
  const id = randomUUID();
  await call(cfg, "/searches", {
    method: "POST",
    body: JSON.stringify({ id, searchText: text }),
  });
  return id;
}

export async function searchResponses(
  cfg: SlskdConfig,
  id: string,
): Promise<SlskdResponse[]> {
  return (await call<SlskdResponse[]>(cfg, `/searches/${id}/responses`)) ?? [];
}

/** Has the network stopped answering? Read two ways: that field has changed shape before. */
export async function searchDone(
  cfg: SlskdConfig,
  id: string,
): Promise<boolean> {
  const s = await call<{ isComplete?: boolean; state?: string }>(
    cfg,
    `/searches/${id}`,
  );
  if (typeof s?.isComplete === "boolean") return s.isComplete;
  return (s?.state ?? "").toLowerCase().includes("complete");
}

/** How long to wait for a stopped search to actually be over before giving up on tidying it. */
const RELEASE_WAIT_MS = 10_000;

/** Stop, wait for it to really be over, and only then remove — the order is ../../../docs/media/hunt.md. */
export async function releaseSearch(
  cfg: SlskdConfig,
  id: string,
  waitMs: number = RELEASE_WAIT_MS,
): Promise<void> {
  await call(cfg, `/searches/${id}`, { method: "PUT" }).catch(() => {});
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    if (await searchDone(cfg, id).catch(() => false)) {
      await call(cfg, `/searches/${id}`, { method: "DELETE" }).catch(() => {});
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function enqueue(
  cfg: SlskdConfig,
  username: string,
  file: { filename: string; size: number },
): Promise<void> {
  await call(cfg, `/transfers/downloads/${encodeURIComponent(username)}`, {
    method: "POST",
    body: JSON.stringify([{ filename: file.filename, size: file.size }]),
  });
}

/** Every download of this peer's, flat — the nesting is slskd's to change; ../../../docs/media/hunt.md. */
export function flattenTransfers(body: unknown): Transfer[] {
  const out: Transfer[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (typeof o.filename === "string" && typeof o.state === "string") {
      out.push({
        id: typeof o.id === "string" ? o.id : "",
        filename: o.filename,
        state: o.state,
        size: typeof o.size === "number" ? o.size : undefined,
        bytesTransferred:
          typeof o.bytesTransferred === "number"
            ? o.bytesTransferred
            : undefined,
        percentComplete:
          typeof o.percentComplete === "number" ? o.percentComplete : undefined,
      });
      return;
    }
    for (const x of Object.values(o)) walk(x);
  };
  walk(body);
  return out;
}

export async function downloadsOf(
  cfg: SlskdConfig,
  username: string,
): Promise<Transfer[]> {
  return flattenTransfers(
    await call<unknown>(
      cfg,
      `/transfers/downloads/${encodeURIComponent(username)}`,
    ),
  );
}

/** Give up on one. Ignored on failure: the hunt is already moving to the next peer. */
export async function cancelDownload(
  cfg: SlskdConfig,
  username: string,
  id: string,
): Promise<void> {
  await call(
    cfg,
    `/transfers/downloads/${encodeURIComponent(username)}/${encodeURIComponent(id)}?remove=true`,
    { method: "DELETE" },
  ).catch(() => {});
}

/** The settings screen's test: the daemon answers, and takes the key — its version if it says. */
export async function checkSlskd(cfg: SlskdConfig): Promise<string> {
  const app = await call<{ version?: { full?: string; current?: string } }>(
    cfg,
    "/application",
  );
  const v = app?.version?.full ?? app?.version?.current;
  return v ? `slskd ${v}` : "slskd répond";
}
