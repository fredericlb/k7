// The Supernote Private Cloud protocol, as a client.
//
// Ratta publishes no specification. This follows the community one and every field name
// below was checked against a running server, which answers a request missing a field by
// naming it — that, and not guesswork, is where these come from. See ../../../docs/supernote.md.

import { Blob } from "node:buffer";
import { createHash } from "node:crypto";

/** A logged-in server. The token is a JWT the server gives for 30 days. */
export interface Session {
  baseUrl: string;
  token: string;
}

/** One row of a directory listing, reduced to what a sync needs. */
export interface RemoteEntry {
  id: string;
  fileName: string;
  isFolder: boolean;
}

interface Answer {
  success?: boolean;
  errorMsg?: string;
  [key: string]: unknown;
}

const JSON_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Content-Type": "application/json",
};

const md5 = (value: string | Uint8Array) =>
  createHash("md5").update(value).digest("hex");

/** Every call is a POST of JSON that answers 200 with `success` — an error is in the body. */
async function call(
  baseUrl: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Answer> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { ...JSON_HEADERS, ...headers },
    body: JSON.stringify(body ?? {}),
    // A hung Supernote would hold the owner's run lock until a restart (sync.ts).
    signal: AbortSignal.timeout(30_000),
  });
  const answer = (await res.json().catch(() => ({}))) as Answer;
  if (!res.ok || !answer.success) {
    throw new Error(answer.errorMsg || `${path} answered ${res.status}`);
  }
  return answer;
}

const authed = (session: Session, path: string, body: unknown, extra = {}) =>
  call(session.baseUrl, path, body, {
    "x-access-token": session.token,
    ...extra,
  });

/**
 * Sign in. The password is never sent: the server hands out a one-shot code, and what
 * travels is `sha256(md5(password) + code)`.
 */
export async function login(
  baseUrl: string,
  account: string,
  password: string,
): Promise<Session> {
  const root = baseUrl.replace(/\/+$/, "");
  const challenge = await call(root, "/api/official/user/query/random/code", {
    countryCode: null,
    account,
  });
  const randomCode = String(challenge.randomCode ?? "");
  if (!randomCode) throw new Error("the server sent no random code");

  const hashed = createHash("sha256")
    .update(md5(password) + randomCode)
    .digest("hex");

  const answer = await call(root, "/api/official/user/account/login/new", {
    countryCode: null,
    account,
    password: hashed,
    browser: "k7",
    equipment: "1",
    loginMethod: "1",
    timestamp: challenge.timestamp,
    language: "en",
  });
  const token = String(answer.token ?? "");
  if (!token) throw new Error("the server sent no token");
  return { baseUrl: root, token };
}

/** Everything in a directory, page by page — the server caps a page and never says how many. */
export async function listDirectory(
  session: Session,
  directoryId: string,
): Promise<RemoteEntry[]> {
  const pageSize = 100;
  const out: RemoteEntry[] = [];
  let previous = "";
  // Bounded twice: a server that ignores pageNo answers the same full page for ever, so the same page twice ends it, and so does a ceiling.
  for (let pageNo = 1; pageNo <= 1000; pageNo++) {
    const answer = await authed(session, "/api/file/list/query", {
      directoryId,
      pageNo,
      pageSize,
      order: "time",
      sequence: "desc",
    });
    const page = (answer.userFileVOList ?? []) as Record<string, unknown>[];
    const key = page.map((row) => String(row.id)).join(",");
    if (page.length && key === previous) return out;
    previous = key;
    for (const row of page) {
      out.push({
        id: String(row.id),
        fileName: String(row.fileName ?? ""),
        isFolder: row.isFolder === "Y",
      });
    }
    if (page.length < pageSize) return out;
  }
  return out;
}

/** The id of `name` under `parentId`, created if it is not there yet. */
export async function ensureFolder(
  session: Session,
  parentId: string,
  name: string,
): Promise<string> {
  const found = (await listDirectory(session, parentId)).find(
    (e) => e.isFolder && e.fileName === name,
  );
  if (found) return found.id;

  await authed(session, "/api/file/folder/add", {
    directoryId: parentId,
    fileName: name,
  });
  // The creation answers no id of its own, so the listing is what names it.
  const made = (await listDirectory(session, parentId)).find(
    (e) => e.isFolder && e.fileName === name,
  );
  if (!made) throw new Error(`could not create the folder ${name}`);
  return made.id;
}

/** A folder reached by path from the root, every level created as needed. */
export async function ensureFolderPath(
  session: Session,
  path: string,
): Promise<string> {
  let id = "0";
  for (const part of path.split("/").filter(Boolean)) {
    id = await ensureFolder(session, id, part);
  }
  return id;
}

export async function deleteFiles(
  session: Session,
  directoryId: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  await authed(session, "/api/file/delete", { directoryId, idList: ids });
}

/**
 * The URL `apply` grants, made reachable. The server builds it from its own idea of where
 * it lives, which is wrong the moment it sits behind a proxy mounted on a path: it hands
 * out `/api/oss/upload` while the world reaches it at `/priv/supernote/api/oss/upload`.
 * So its path and query are kept and the rest comes from the address we were given — and
 * a server already answering under that prefix, or at a root, is left alone.
 */
export function rerootUpload(baseUrl: string, granted: string): string {
  const url = new URL(granted);
  const base = new URL(baseUrl);
  if (url.pathname.startsWith(base.pathname)) return granted;
  return `${baseUrl}${url.pathname}${url.search}`;
}

/** The nonce `upload/apply` wants: ten digits and the timestamp it was signed with. */
function applyNonce(timestamp: string): string {
  return `${Math.floor(Math.random() * 1e10)}`.padStart(10, "0") + timestamp;
}

/**
 * Upload in three steps, which is the server's shape and not ours: ask for a signed URL,
 * post the bytes to it, then declare the transfer done so the file becomes visible.
 */
export async function uploadFile(
  session: Session,
  directoryId: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<void> {
  const digest = md5(bytes);
  const timestamp = String(Date.now());
  const apply = await authed(
    session,
    "/api/file/upload/apply",
    { size: bytes.length, fileName, directoryId, md5: digest },
    { timestamp, nonce: applyNonce(timestamp) },
  );

  const granted = String(apply.fullUploadUrl ?? "");
  if (!granted) throw new Error("the server granted no upload URL");
  const url = rerootUpload(session.baseUrl, granted);
  const innerName = String(apply.innerName ?? fileName);

  const form = new FormData();
  form.append("file", new Blob([bytes]), fileName);
  const sent = await fetch(url, {
    method: "POST",
    headers: { Accept: "*/*", "x-access-token": session.token },
    body: form,
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!sent.ok)
    throw new Error(`the upload of ${fileName} answered ${sent.status}`);

  await authed(session, "/api/file/upload/finish", {
    directoryId,
    fileName,
    fileSize: bytes.length,
    innerName,
    md5: digest,
  });
}
