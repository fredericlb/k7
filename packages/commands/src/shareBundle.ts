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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { ProjectDoc } from "@studio/song/project";
import {
  MP3_CODEC,
  type RenderManifest,
  renderMixdown,
  transcode,
} from "./render.ts";

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

/**
 * Which slot each rendered stem takes, and which track it came from.
 *
 * The engine names a stem by the TRACK's name (`OfflineRender.cpp`, `manifest.stems[].name`), and
 * a track name is a human string: it can hold a slash, a quote, or the same characters as its
 * neighbour. Those names would become URL segments, so none of them is used as one — this maps
 * each stem onto a slot id WE choose, and keeps the human name as a label.
 *
 * Matched by name, because that is the only thing the two sides share; a name that is ambiguous
 * or unknown falls back to the slot's own number rather than guessing at an order. The slot is
 * therefore always assigned and always safe, and the `track` it reports may be empty — which the
 * viewer reads as "a stem with no lane to point at", not as an error.
 */
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

/**
 * Render the project and lay a snapshot out in a temp directory.
 *
 * ONE engine pass for the lot: `renderMixdown(..., {stems:true})` writes the mixdown and one wav
 * per audible track together. That is what "every module is frozen" means here — not N freezes
 * writing `frozen:` into N module files, which would edit the project being shared. **Nothing in
 * this function writes to the project.** It reads a compiled document and produces bytes.
 *
 * The renders are MOVED rather than copied: they are already in this temp directory, and a
 * snapshot of a long song is gigabytes.
 *
 * The caller owns `cleanup` and must call it — the upload streams from these files, so they
 * cannot be removed until it is done.
 */
export function buildShareBundle(
  engineBin: string,
  doc: ProjectDoc,
  /** Filename → the JSON to write beside the audio. The viewer asks for these by name. */
  docs: Record<string, unknown>,
  meta: { name: string },
): ShareBundle {
  const dir = mkdtempSync(join(tmpdir(), "tbshare-"));
  const cleanup = () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort, exactly as the other render paths do */
    }
  };
  try {
    const rendered: RenderManifest = renderMixdown(engineBin, doc, dir, {
      stems: true,
    });
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

    // The mixdown stays WAV: it is the one file a visitor may download, and a download is the one
    // place the format is theirs to keep rather than ours to stream.
    const mix = {
      file: "audio/mix.wav",
      bytes: take(rendered.mix, "audio/mix.wav"),
    };
    /**
     * The stems are transcoded, and the number is why.
     *
     * Measured on `01.danse.l8`: twelve lanes, 37.2 MB of wav each, **484 MB for one share** —
     * and a share has no expiry, on the volume that also holds everybody's médiathèque. A stem
     * here is for HEARING a lane in a browser, not for mastering, so mp3 is not a compromise:
     * it is what the file is for. Roughly thirty times smaller, and a phone stops downloading
     * 37 MB to unmute one lane.
     *
     * ffmpeg missing costs the compression and nothing else — `transcode` answers false and the
     * wav stays, which is the same bargain every other render path here makes.
     */
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
      writeFileSync(join(dir, file), JSON.stringify(body), "utf8");

    const files = [mix.file, ...stems.map((s) => s.file), ...Object.keys(docs)];
    const manifest: ShareManifest = {
      schema: SHARE_SCHEMA,
      name: meta.name,
      createdAt: new Date().toISOString(),
      // `video: false` is stated rather than left out: a project may declare a viewport surface,
      // and `surfaces.json` goes up verbatim so the snapshot never lies about the project. What
      // it must say instead is which of those surfaces it CARRIES media for.
      media: { mix, stems, video: false },
      docs: Object.keys(docs),
      bytes: mix.bytes + stems.reduce((n, s) => n + s.bytes, 0),
    };
    writeFileSync(
      join(dir, "snapshot.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
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
  /** The machine's `service:l8` bearer — `mediatekToken()`. */
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

/**
 * Send a bundle to pl8, in the three steps that service's upload takes.
 *
 * Draft, then one raw PUT per file, then finish — and NOT a multipart form, which is k7's
 * convention rather than pl8's: `express.raw` is what every upload route there takes, because a
 * 400 MB master must never be a field in a form parse. The global `express.json` is 8 MB, so the
 * manifest travels as JSON and the audio does not.
 *
 * `finish` is what makes the link answer, which is what stops a crashed upload from being
 * reachable and short: until then `pending.json` says "not yet" to every public route.
 *
 * The bytes are STREAMED. `shareToK7` reads its mixdown into a Blob, which is fine for one mp3
 * and is not for a folder of stems.
 */
export async function uploadShare(
  bundle: ShareBundle,
  to: ShareTarget,
): Promise<ShareLink> {
  const auth = { Authorization: `Bearer ${to.token}` };
  // EVERY call carries `?user=`, not just the first: the credential is the MACHINE's
  // (`service:l8`), so each request has to name the person again or pl8 files it under a service
  // that owns nothing. The three steps are three requests and none of them remembers the others.
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
