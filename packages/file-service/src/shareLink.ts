// shareLink.ts — `project share link`: a share made at a CHECKPOINT and played by the server's engine. The steps
// run as one job per workspace whose progress the editor polls: every VST track rendered, every edit on the server,
// the checkpoint named, the share built from it (shareSnapshot.ts) and sent to the media library. See docs/share.md.
// The one thing a reader would get wrong: the link is answered only once every step is done, never before.

import { createReadStream } from "node:fs";
import { join, relative, sep } from "node:path";
import { Readable } from "node:stream";
import {
  type CheckpointFiles,
  HUB_SECRET_HEADER,
  type ShareProgress,
} from "@studio/web-protocol";
import { autoFreezer } from "./autoFreezeJobs.ts";
import { settledSeq } from "./liveSync.ts";
import { mediatekBase, mediatekToken } from "./mediatekLink.ts";
import {
  buildShareSnapshot,
  checkpointPrefixes,
  type ShareSnapshot,
} from "./shareSnapshot.ts";

/** What the job needs of the workspace: its root and its open project. */
export interface ShareLinkHost {
  root: string;
  requireActive(): string;
}

const jobs = new Map<string, ShareProgress>();

/** Where the share being made in the workspace at `root` is, or null when none was asked for. */
export const shareProgress = (root: string): ShareProgress | null =>
  jobs.get(root) ?? null;

/** Start making a share of the open project; a second ask while one runs is the same job. */
export function startShareLink(host: ShareLinkHost, userEmail: string): void {
  const running = jobs.get(host.root);
  if (running && running.step !== "done" && running.step !== "failed") return;
  const report = (p: ShareProgress) => jobs.set(host.root, p);
  report({ step: "sync", done: 0, total: 1 });
  makeShare(host, userEmail, report).then(
    (link) =>
      report({
        step: "done",
        done: 1,
        total: 1,
        token: link.token,
        bytes: link.bytes,
      }),
    (e: Error) =>
      report({ step: "failed", done: 0, total: 0, error: e.message }),
  );
}

/** The media library's share API, as this account: base, bearer, and the `?user=` every call names. */
function library(userEmail: string) {
  const base = mediatekBase();
  const token = mediatekToken();
  if (!base || !token)
    throw new Error(
      "no médiathèque to share to — the file hub gave this service no MEDIATEK_URL / MEDIATEK_TOKEN",
    );
  return {
    api: `${base.replace(/\/+$/, "")}/api/shares`,
    auth: { Authorization: `Bearer ${token}` },
    user: `user=${encodeURIComponent(userEmail)}`,
  };
}

async function ok<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    let said = body;
    try {
      said = (JSON.parse(body) as { error?: string }).error ?? body;
    } catch {
      // Not JSON: the text is the message.
    }
    throw new Error(`${what}: ${said}`);
  }
  return (await res.json()) as T;
}

/** One of the hub's share routes, on this service's own secret (file-hub's shareHistory.ts). */
async function hub<T>(path: string, body: unknown, what: string): Promise<T> {
  const url = process.env.STUDIO_HUB_URL;
  if (!url) throw new Error("no file hub here — a share is made on the server");
  return ok<T>(
    await fetch(`${url}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [HUB_SECRET_HEADER]: process.env.STUDIO_HUB_SECRET ?? "",
      },
      body: JSON.stringify(body),
    }),
    what,
  );
}

async function makeShare(
  host: ShareLinkHost,
  userEmail: string,
  report: (p: ShareProgress) => void,
): Promise<{ token: string; bytes: number }> {
  const lib = library(userEmail);
  // Before any work: a server with no engine plays no share, so it takes none.
  const can = await ok<{ available: boolean; why?: string }>(
    await fetch(`${lib.api}/player?${lib.user}`, { headers: lib.auth }),
    "asking whether this server plays shares",
  );
  if (!can.available)
    throw new Error(can.why ?? "this server has no engine to play shares on");

  const dir = host.requireActive();
  const projectRel = relative(host.root, dir).split(sep).join("/");
  const project = projectRel.split("/").pop() ?? projectRel;

  report({ step: "freeze", done: 0, total: 0 });
  const impossible = await autoFreezer.renderAllNow(
    dir,
    (done, total, module) =>
      report({ step: "freeze", done, total, detail: module }),
  );
  if (impossible.length)
    throw new Error(
      `no connected engine can render ${impossible
        .map((f) => `${f.module} (${f.plugins.join(", ")})`)
        .join(
          "; ",
        )} — open the project on a machine that has the plugin, then share again`,
    );

  report({ step: "sync", done: 0, total: 1 });
  const { room, seq } = await settledSeq(host.root);

  report({ step: "checkpoint", done: 0, total: 1 });
  const name = `share: ${project}`;
  await hub(
    "/share/checkpoint",
    { workspace: room, seq, name },
    "naming the checkpoint",
  );

  report({ step: "pack", done: 0, total: 1 });
  const files = await hub<CheckpointFiles>(
    "/share/files",
    { workspace: room, seq, prefixes: checkpointPrefixes(projectRel) },
    "reading the checkpoint",
  );
  const snap = buildShareSnapshot(
    files,
    { workspace: room, seq, name },
    projectRel,
  );
  try {
    return await upload(snap, lib, { repo: room, project }, (done, total, at) =>
      report({ step: "upload", done, total, detail: at }),
    );
  } finally {
    snap.cleanup();
  }
}

/** Draft, one raw PUT per file, finish: the media library takes no multipart (docs/share.md). */
async function upload(
  snap: ShareSnapshot,
  lib: ReturnType<typeof library>,
  origin: { repo: string; project: string },
  onBytes: (done: number, total: number, file: string) => void,
): Promise<{ token: string; bytes: number }> {
  const draft = await ok<{ key: string; token: string; expects: string[] }>(
    await fetch(`${lib.api}?${lib.user}`, {
      method: "POST",
      headers: { ...lib.auth, "content-type": "application/json" },
      body: JSON.stringify({ manifest: snap.manifest, origin }),
    }),
    "opening the share",
  );
  const sizes = new Map(
    [
      ...snap.manifest.files,
      ...[...snap.manifest.docs, snap.manifest.engineDoc].map((path) => ({
        path,
        bytes: 0,
      })),
    ].map((f) => [f.path, f.bytes]),
  );
  const total = snap.manifest.bytes;
  let sent = 0;
  for (const rel of draft.expects) {
    onBytes(sent, total, rel);
    const res = await fetch(
      `${lib.api}/${draft.key}/file?${lib.user}&path=${encodeURIComponent(rel)}`,
      {
        method: "PUT",
        headers: { ...lib.auth, "content-type": "application/octet-stream" },
        body: Readable.toWeb(
          createReadStream(join(snap.dir, rel)),
        ) as unknown as ReadableStream,
        // Node needs telling that the body streams and that no answer is expected before it ends.
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    );
    await ok(res, `uploading ${rel}`);
    sent += sizes.get(rel) ?? 0;
  }
  onBytes(total, total, "");
  const done = await ok<{ bytes: number }>(
    await fetch(`${lib.api}/${draft.key}/finish?${lib.user}`, {
      method: "POST",
      headers: { ...lib.auth, "content-type": "application/json" },
      body: JSON.stringify({ token: draft.token }),
    }),
    "publishing the share",
  );
  return { token: draft.token, bytes: done.bytes };
}
