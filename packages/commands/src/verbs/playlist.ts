// playlist.ts — the `playlist …` verbs: the REPOSITORY's set lists.
//
// `_playlists/` sits at the workspace root, beside `_modules`, so these verbs act on `repoDir` and
// not on `songPath`: a playlist belongs to the repository and stays the same whatever project is
// open. They are the only verbs in the catalogue that work without a project — except
// `playlist stems`, which needs one to resolve its chain, and says so.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { coldOutDir, runColdPasses } from "@studio/audio-passes/coldPass";
import {
  type ResolvedChain,
  resolveChain,
} from "@studio/audio-passes/processChain";
import { familyDir } from "@studio/mediatek/layout";
import { isAudio } from "@studio/mediatek/media";
import {
  appendPlaylistItem,
  type PlaylistItem,
  parsePlaylist,
  playlistStub,
} from "@studio/song-schema/playlist";
import type { SidHandler } from "../commands.ts";
import { playlistFile, splitWords } from "./shared.ts";

export const PLAYLIST_VERBS: Record<string, SidHandler> = {
  "playlist.new": (a, h) => {
    const name = a.trim();
    if (!name) return h.refuse(["usage: playlist new <name>"]);
    const found = playlistFile(name, h);
    if (!found) return;
    // Refused rather than opened: handing back somebody else's set list is how you edit the wrong one.
    if (existsSync(found.abs))
      return h.refuse([`${found.rel} is already there`]);
    try {
      mkdirSync(dirname(found.abs), { recursive: true });
      // The STUB rather than an empty file, which would open on a parse failure. See docs/playlist.md.
      writeFileSync(
        found.abs,
        playlistStub(basename(found.rel).replace(/\.ya?ml$/i, "")),
        "utf8",
      );
    } catch (e) {
      return h.refuse([`playlist new: ${(e as Error).message}`]);
    }
    h.log([`+ playlist ${found.rel}`]);
  },
  /** `playlist stems <playlist> [chain]` — the night before a gig, see docs/playlist.md. */
  "playlist.stems": async (a, h) => {
    const [first, ...rest] = splitWords(a);
    // Named on the line, else the machine's standing answer. One question, asked once.
    const chainRef = rest.join(" ") || h.stemsChain || "";
    if (!first)
      return h.refuse([
        "usage: playlist stems <playlist> [chain]",
        "       (e.g. playlist stems ete-2026 @st0/stems)",
      ]);
    if (!chainRef)
      return h.refuse([
        "no separating chain: name one, or set this machine's with `system stems <chaîne>`",
      ]);
    const found = playlistFile(first.replace(/^"(.*)"$/s, "$1"), h);
    if (!found) return;
    let items: PlaylistItem[];
    try {
      items = parsePlaylist(readFileSync(found.abs, "utf8"))?.items ?? [];
    } catch {
      return h.refuse([
        `no playlist ${found.rel} — make one with: playlist new <name>`,
      ]);
    }
    if (!items.length) return h.refuse([`${found.rel} names no song`]);

    // Resolved against the OPEN PROJECT's module vocabulary, like every cold step — docs/playlist.md.
    let chain: ResolvedChain;
    try {
      chain = resolveChain(h.songPath, h.project(), chainRef);
    } catch (e) {
      return h.refuse([`playlist stems: ${(e as Error).message}`]);
    }
    if (!chain.cold.length)
      return h.refuse([
        `'${chainRef}' does not separate — this verb runs a chain whose step is an offline module`,
      ]);
    if (!h.runColdStep)
      return h.refuse(["this host cannot run an offline step"]);

    const songs = familyDir("songs");
    const lines: string[] = [];
    let done = 0;
    let skipped = 0;
    for (const item of items) {
      const folder = join(songs, ...item.song.split("/"));
      // The master is the FIRST audio file in the folder and the scan does not descend.
      let master: string | undefined;
      try {
        master = readdirSync(folder, { withFileTypes: true }).find(
          (e) => e.isFile() && isAudio(e.name),
        )?.name;
      } catch {
        lines.push(`${item.song}: not on this machine`);
        continue;
      }
      if (!master) {
        lines.push(`${item.song}: no audio in its folder`);
        continue;
      }
      // "Already done" is a question about the FOLDER, not a flag anybody keeps — docs/playlist.md.
      const out = coldOutDir(join(folder, master));
      const held = existsSync(out) ? readdirSync(out).filter(isAudio) : [];
      if (held.length) {
        skipped += 1;
        continue;
      }
      try {
        const wrote = await runColdPasses(
          [join(folder, master)],
          chain.cold,
          h.runColdStep,
        );
        done += 1;
        lines.push(
          `${item.song}: ${wrote.reduce((n, d) => n + d.files.length, 0)} stem(s)`,
        );
      } catch (e) {
        // Per song, and the loop goes on: one unreadable file must not cost the other twenty-nine.
        lines.push(`${item.song}: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    h.log([
      `${found.rel} through '${chain.ref}': ${done} separated` +
        (skipped ? `, ${skipped} already done` : ""),
      ...lines,
    ]);
  },
  /** `playlist song add <playlist> <song> [variant]` — quote the song to name a variant, docs/playlist.md. */
  "playlist.song.add": (a, h) => {
    const m = /^("[^"]*"|\S+)\s+(.+)$/.exec(a.trim());
    if (!m)
      return h.refuse([
        "usage: playlist song add <playlist> <song> [variant]  (quote the song to name a variant)",
      ]);
    const found = playlistFile(m[1].replace(/^"(.*)"$/s, "$1"), h);
    if (!found) return;
    const { rel, abs } = found;
    let text: string;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      return h.refuse([
        `no playlist ${rel} — make one with: playlist new <name>`,
      ]);
    }
    const quoted = /^"([^"]*)"\s*(.*)$/.exec(m[2].trim());
    const song = quoted ? quoted[1] : m[2].trim();
    const variant = quoted ? quoted[2].trim() : "";
    if (!song) return h.refuse(["a playlist line names a song"]);
    const next = appendPlaylistItem(text, {
      song,
      ...(variant ? { variant } : {}),
    });
    // Null is the FILE's shape refusing the append — see docs/playlist.md.
    if (next === null)
      return h.refuse([
        `${rel}: the way \`items:\` is written there is not a shape this can extend — add the line by hand`,
      ]);
    try {
      h.snapshot?.(abs);
      writeFileSync(abs, next, "utf8");
    } catch (e) {
      return h.refuse([`playlist song add: ${(e as Error).message}`]);
    }
    const count = parsePlaylist(next)?.items.length;
    h.log([
      `${rel}: + ${song}${variant ? ` (${variant})` : ""}${count ? ` — ${count} song${count > 1 ? "s" : ""}` : ""}`,
    ]);
  },
};
