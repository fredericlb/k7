// shareBundle.ts — the frozen snapshot `project share link` uploads: one render pass, its
// mixdown and stems, and the documents a browser draws a project from. Self-contained by
// construction — nothing in it names a machine, a path or a person. See docs/shareBundle.md.

import {
  createReadStream,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { ProjectDoc } from "@studio/song/project";
import { wsWrite } from "@studio/song/yaml/workspaceFile";
import {
  MP3_CODEC,
  type Renderer,
  type RenderManifest,
  transcode,
} from "@studio/take-render/render";

/** The bundle format. Bumped when a viewer would read an older one wrong — never for an addition. */
export const SHARE_SCHEMA = 1;

/** One rendered track. `file` is ours; `name` is the human one and never touches a path. */
export interface ShareStem {
  /** The slot this stem occupies — the file's name without its extension. URL-safe by construction. */
  id: string;
  /** The track it came from, when we could tell. Empty when the render's name matched none. */
  track: string;
  /** What to call it on screen: the track's own name, whatever characters that holds. */
  name: string;
  /** Where the bytes are, extension included — `.mp3` normally, `.wav` where ffmpeg was absent. */
  file: string;
  bytes: number;
}

export interface ShareManifest {
  schema: number;
  name: string;
  createdAt: string;
  media: {
    mix: { file: string; bytes: number };
    stems: ShareStem[];
    /** Always false in this version, and SAID rather than omitted — see the header of `docs`. */
    video: boolean;
  };
  /** The documents beside the audio, by filename. What the viewer may ask for, and nothing else. */
  docs: string[];
  bytes: number;
}

export interface ShareBundle {
  /** The temp directory holding it. Every path below is relative to this. */
  dir: string;
  manifest: ShareManifest;
  /** Every file to upload, manifest-relative, in the order they should go. */
  files: string[];
  cleanup: () => void;
}

/** Which slot each stem takes, and which track it came from — see docs/shareBundle.md. */
export function stemSlots(
  tracks: readonly { id: string; name?: string }[],
  stems: readonly { name: string; file: string }[],
): ShareStem[] {
  const byName = new Map<string, string | null>();
  for (const t of tracks) {
    const key = (t.name ?? t.id).trim();
    // null marks a name two tracks share: it cannot identify either of them.
    byName.set(key, byName.has(key) ? null : t.id);
  }
  return stems.map((s, i) => {
    const id = `s${i}`;
    return {
      id,
      track: byName.get(s.name.trim()) ?? "",
      name: s.name,
      file: `audio/${id}.wav`,
      bytes: 0,
    };
  });
}

/** Render the project in ONE pass and lay a snapshot out in a temp dir — docs/shareBundle.md. */
export async function buildShareBundle(
  render: Renderer,
  doc: ProjectDoc,
  /** Filename → the JSON to write beside the audio. The viewer asks for these by name. */
  docs: Record<string, unknown>,
  meta: { name: string },
): Promise<ShareBundle> {
  const dir = mkdtempSync(join(tmpdir(), "tbshare-"));
  const cleanup = () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort, exactly as the other render paths do */
    }
  };
  try {
    const rendered: RenderManifest = await render(doc, dir, { stems: true });
    mkdirSync(join(dir, "audio"), { recursive: true });

    const bytesOf = (rel: string): number => {
      try {
        return statSync(join(dir, rel)).size;
      } catch {
        return 0;
      }
    };
    const take = (from: string, to: string): number => {
      renameSync(join(dir, from), join(dir, to));
      return bytesOf(to);
    };

    // The mixdown stays WAV: it is the one file a visitor may download. See docs/shareBundle.md.
    const mix = {
      file: "audio/mix.wav",
      bytes: take(rendered.mix, "audio/mix.wav"),
    };
    // The stems are transcoded, and 484 MB for one share is why — see docs/shareBundle.md.
    const stems = stemSlots(doc.tracks ?? [], rendered.stems).map((s, i) => {
      const wav = `audio/${s.id}.wav`;
      take(rendered.stems[i].file, wav);
      const mp3 = `audio/${s.id}.mp3`;
      const small = transcode(join(dir, wav), join(dir, mp3), MP3_CODEC);
      if (small) rmSync(join(dir, wav), { force: true });
      const file = small ? mp3 : wav;
      return { ...s, file, bytes: bytesOf(file) };
    });

    for (const [file, body] of Object.entries(docs))
      wsWrite(join(dir, file), JSON.stringify(body));

    const files = [mix.file, ...stems.map((s) => s.file), ...Object.keys(docs)];
    const manifest: ShareManifest = {
      schema: SHARE_SCHEMA,
      name: meta.name,
      createdAt: new Date().toISOString(),
      // `video: false` is stated rather than left out — see docs/shareBundle.md.
      media: { mix, stems, video: false },
      docs: Object.keys(docs),
      bytes: mix.bytes + stems.reduce((n, s) => n + s.bytes, 0),
    };
    wsWrite(join(dir, "snapshot.json"), JSON.stringify(manifest, null, 2));
    return { dir, manifest, files, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

/** Where the snapshot goes, and who it is filed under. */
export interface ShareTarget {
  /** pl8's base URL — `mediatekBase()` on the machine that renders. */
  base: string;
  /** The machine's `service:k7` bearer — `mediatekToken()`. */
  token: string;
  /** Whose share this is. A service token has no person of its own and must name one. */
  user: string;
  origin: { repo: string; project: string };
}

export interface ShareLink {
  key: string;
  /** The secret. Everything else here is public; this is the whole of the protection. */
  token: string;
  bytes: number;
}

async function ok(res: Response, what: string): Promise<unknown> {
  if (!res.ok)
    throw new Error(`${what} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Send a bundle to pl8: draft, one raw PUT per file, finish — see docs/shareBundle.md. */
export async function uploadShare(
  bundle: ShareBundle,
  to: ShareTarget,
): Promise<ShareLink> {
  const auth = { Authorization: `Bearer ${to.token}` };
  // EVERY call carries `?user=`, not just the first — see docs/shareBundle.md.
  const user = `user=${encodeURIComponent(to.user)}`;
  const api = `${to.base.replace(/\/+$/, "")}/api/shares`;

  const draft = (await ok(
    await fetch(`${api}?${user}`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ manifest: bundle.manifest, origin: to.origin }),
    }),
    "opening the share",
  )) as { key: string; token: string; expects: string[] };

  for (const rel of draft.expects) {
    const res = await fetch(
      `${api}/${draft.key}/file?${user}&path=${encodeURIComponent(rel)}`,
      {
        method: "PUT",
        headers: { ...auth, "content-type": "application/octet-stream" },
        body: Readable.toWeb(
          createReadStream(join(bundle.dir, rel)),
        ) as unknown as ReadableStream,
        // Node needs telling that the body streams and that no answer is expected before it ends.
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    );
    await ok(res, `uploading ${rel}`);
  }

  const done = (await ok(
    await fetch(`${api}/${draft.key}/finish?${user}`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ token: draft.token }),
    }),
    "publishing the share",
  )) as { bytes: number };

  return { key: draft.key, token: draft.token, bytes: done.bytes };
}
