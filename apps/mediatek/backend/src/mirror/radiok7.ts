// radiok7.ts — pull radiok7's finished recordings into `morceaux/recorded/`. One direction
// only: the médiathèque never writes back to Grist, which stays the truth for radiok7 until
// it doesn't. Idempotent because every mirrored folder carries its upstream key, so the
// mirror finds its own work by that key and not by where it happens to sit. See docs/mirror.md.

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { GristClient, GristRecord } from "@frediverse/db-grist";
import { familyDir } from "@studio/mediatek/layout";
import { parse as parseYaml } from "yaml";

/** The sidecar key carrying the upstream identity. Prefixed by table, so mirroring a
 *  second one later cannot collide with a uid that happens to look the same. */
const KEY_PREFIX = "version:";

export interface MirrorReport {
  /** Folders created — a recording the library did not have. */
  added: string[];
  /** Folders whose sidecar was rewritten because the upstream metadata moved. */
  updated: string[];
  /** Already present and unchanged. The number that should dominate on a second run. */
  unchanged: string[];
  failed: { key: string; error: string }[];
  /** Upstream rows that carried no audio at all — reported, never invented. */
  skipped: { key: string; reason: string }[];
}

/** What one upstream version becomes, before it touches a disk. */
interface Mirrored {
  key: string;
  title: string;
  artist: string;
  songUuid: string;
  releaseUid: string;
  versionName: string;
  isDefault: boolean;
  createdAt: string;
  attachmentId: number;
  mime: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A folder name a human can read, from what is stable enough to name by. Punctuation goes
 *  rather than being escaped: this becomes a path on three operating systems. */
export function slugFor(m: Mirrored): string {
  const base = [m.artist, m.title].filter(Boolean).join(" - ") || "untitled";
  const suffix =
    m.versionName && m.versionName !== "Version" ? ` (${m.versionName})` : "";
  return (
    `${base}${suffix}`
      // Decompose, then drop the combining marks: "Café" becomes "Cafe" rather than "Caf",
      // which is what a bare non-word strip would have left.
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      // Parentheses survive — they are legal on all three operating systems and they are
      // what makes "(Mix final)" read as a version rather than as part of the title.
      .replace(/[^\w\s.()-]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80)
      // …plus a short tail of the upstream key, because two versions can share every field
      // above and a collision would have one silently overwrite the other.
      .concat(` [${m.key.slice(KEY_PREFIX.length, KEY_PREFIX.length + 8)}]`)
  );
}

/** The file extension for what radiok7 stored. Unknown means `.bin` rather than a guess:
 *  a wrong extension is a file the scan will not see as audio, which reads as a lost take. */
export function extFor(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("wav")) return ".wav";
  if (m.includes("flac")) return ".flac";
  if (m.includes("mpeg") || m.includes("mp3")) return ".mp3";
  if (m.includes("ogg")) return ".ogg";
  if (m.includes("aac") || m.includes("m4a") || m.includes("mp4"))
    return ".m4a";
  return ".bin";
}

/** The sidecar text. `grist` is what makes the next run idempotent; `source` is what makes
 *  a human reading the folder know it is not theirs to edit. */
export function sidecarFor(m: Mirrored): string {
  const lines = [
    "# Mirrored from radiok7. Edits here are overwritten by the next pull —",
    "# change it upstream instead. See apps/mediatek/docs/mirror.md.",
    `title: ${JSON.stringify(m.title || "untitled")}`,
    `artist: ${JSON.stringify(m.artist)}`,
    `grist: ${JSON.stringify(m.key)}`,
    `source: radiok7`,
    `release: ${JSON.stringify(m.releaseUid)}`,
    `version: ${JSON.stringify(m.versionName)}`,
    `default: ${m.isDefault}`,
  ];
  if (m.songUuid) lines.push(`uuid: ${JSON.stringify(m.songUuid)}`);
  if (m.createdAt) lines.push(`recordedAt: ${JSON.stringify(m.createdAt)}`);
  return `${lines.join("\n")}\n`;
}

/** Every folder already mirrored, by upstream key. Found by READING the sidecars rather
 *  than by guessing paths: the key is the identity, a folder name is only a label. */
function existingByKey(recordedDir: string): Map<string, string> {
  const out = new Map<string, string>();
  let names: string[];
  try {
    names = readdirSync(recordedDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return out;
  }
  for (const name of names) {
    try {
      const y = parseYaml(
        readFileSync(join(recordedDir, name, "morceau.yaml"), "utf8"),
        {
          version: "1.2",
        },
      ) as Record<string, unknown> | null;
      const key = str(y?.grist);
      if (key.startsWith(KEY_PREFIX)) out.set(key, name);
    } catch {
      /* not a mirrored folder, or not a folder at all */
    }
  }
  return out;
}

/** Flatten radiok7's Releases × Versions into the units the library files. */
export function plan(
  releases: GristRecord[],
  versionsByRelease: Map<string, GristRecord[]>,
): { items: Mirrored[]; skipped: { key: string; reason: string }[] } {
  const items: Mirrored[] = [];
  const skipped: { key: string; reason: string }[] = [];
  for (const r of releases) {
    const rf = r.fields as Record<string, unknown>;
    const releaseUid = str(rf.Uid);
    for (const v of versionsByRelease.get(releaseUid) ?? []) {
      const vf = v.fields as Record<string, unknown>;
      const key = `${KEY_PREFIX}${str(vf.Uid)}`;
      const attachmentId = Number(vf.AudioId ?? 0);
      // A version row with no attachment is a real state upstream — an upload that failed
      // halfway. Reported rather than mirrored as an empty folder, which would read as a
      // recording the library HAS and cannot play.
      if (!attachmentId) {
        skipped.push({ key, reason: "the upstream version carries no audio" });
        continue;
      }
      items.push({
        key,
        title: str(rf.Title),
        artist: str(rf.Artist),
        songUuid: str(rf.SongUuid),
        releaseUid,
        versionName: str(vf.Name) || "Version",
        isDefault: Boolean(vf.IsDefault),
        createdAt: str(vf.CreatedAt),
        attachmentId,
        mime: str(vf.AudioMime) || "audio/wav",
      });
    }
  }
  return { items, skipped };
}

/**
 * Pull every release version into `morceaux/recorded/`.
 *
 * **Bytes are immutable, metadata is not.** radiok7 never replaces a version's audio — a
 * new mix is a new version — but a release's title and artist can be edited any time. So a
 * folder that already exists has its sidecar refreshed and its audio left alone, which is
 * what keeps a second run cheap instead of re-downloading the library.
 *
 * **Folders are never renamed.** A retitled release keeps its original folder name, and
 * only the sidecar's `title` moves. The path is the catalogue entry's id and a cache's
 * manifest key, so churning it would cost every machine a full re-download of a file whose
 * bytes did not change — a large price for a cosmetic gain.
 */
export async function mirrorRadiok7(
  grist: GristClient,
  opts: { ownerId?: string } = {},
): Promise<MirrorReport> {
  const recordedDir = join(familyDir("morceaux"), "recorded");
  mkdirSync(recordedDir, { recursive: true });

  const releases = await grist.listRecords(
    "Releases",
    opts.ownerId ? { OwnerId: [opts.ownerId] } : undefined,
  );
  const versionsByRelease = new Map<string, GristRecord[]>();
  for (const r of releases) {
    const uid = str((r.fields as Record<string, unknown>).Uid);
    if (uid)
      versionsByRelease.set(
        uid,
        await grist.listRecords("Versions", { ReleaseUid: [uid] }),
      );
  }

  const { items, skipped } = plan(releases, versionsByRelease);
  const existing = existingByKey(recordedDir);
  const report: MirrorReport = {
    added: [],
    updated: [],
    unchanged: [],
    failed: [],
    skipped,
  };

  for (const m of items) {
    const known = existing.get(m.key);
    const folder = known ?? slugFor(m);
    const abs = join(recordedDir, folder);
    const sidecar = join(abs, "morceau.yaml");
    const wanted = sidecarFor(m);
    try {
      if (known) {
        let current = "";
        try {
          current = readFileSync(sidecar, "utf8");
        } catch {
          /* sidecar lost — rewrite it */
        }
        if (current === wanted) {
          report.unchanged.push(folder);
          continue;
        }
        writeFileSync(sidecar, wanted, "utf8");
        report.updated.push(folder);
        continue;
      }

      mkdirSync(abs, { recursive: true });
      const bytes = await grist.downloadAttachment(m.attachmentId);
      // Written under a temp name and renamed, like the cache's own fetch: a pull
      // interrupted halfway must leave a whole file or none, never a truncated one the
      // scan would happily list as a playable master.
      const audio = join(abs, `master${extFor(m.mime)}`);
      const tmp = `${audio}.part`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, audio);
      // The sidecar LAST: it is what makes the folder a catalogued morceau, so writing it
      // only after the audio landed means a crash leaves an uncatalogued folder rather
      // than a catalogue entry pointing at nothing.
      writeFileSync(sidecar, wanted, "utf8");
      report.added.push(folder);
    } catch (e) {
      // Clean up a folder we created and could not fill; leave one that was already there.
      if (!known) rmSync(abs, { recursive: true, force: true });
      report.failed.push({ key: m.key, error: (e as Error).message });
    }
  }
  return report;
}
