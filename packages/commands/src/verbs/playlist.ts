// playlist.ts — les verbes `playlist …` : les set lists du DÉPÔT.
//
// `_playlists/` est à la racine de l'espace de travail, à côté de `_modules`, donc ces verbes
// agissent sur `repoDir` et non sur `songPath` : une playlist appartient au dépôt et reste la
// même quel que soit le projet ouvert. Ce sont les seuls verbes du catalogue qui marchent sans
// projet — sauf `playlist stems`, qui en demande un pour résoudre sa chaîne, et le dit.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { familyDir } from "@studio/mediatek/layout";
import { isAudio } from "@studio/mediatek/media";
import {
  appendPlaylistItem,
  type PlaylistItem,
  parsePlaylist,
  playlistStub,
} from "@studio/song/playlist";
import { coldOutDir, runColdPasses } from "../coldPass.ts";
import type { SidHandler } from "../commands.ts";
import { type ResolvedChain, resolveChain } from "../processChain.ts";
import { playlistFile, splitWords } from "./shared.ts";

export const PLAYLIST_VERBS: Record<string, SidHandler> = {
  "playlist.new": (a, h) => {
    const name = a.trim();
    if (!name) return h.refuse(["usage: playlist new <name>"]);
    const found = playlistFile(name, h);
    if (!found) return;
    // Refused rather than opened: a "create" that quietly hands back somebody else's set list is
    // how you edit the wrong one.
    if (existsSync(found.abs))
      return h.refuse([`${found.rel} is already there`]);
    try {
      mkdirSync(dirname(found.abs), { recursive: true });
      // The STUB rather than an empty file: the screen draws its right-hand pane from the text,
      // so an empty one would open on a parse failure for a playlist nobody has got wrong yet.
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
  /**
   * `playlist stems <playlist> [chain]` — separate every song of a set list, before the evening.
   *
   * The preparation half of cutting a stem live: a deck subtracts a stem from the mix it came out
   * of (packages/dsp/docs/stemcut.md), and it can only do that over files that already exist.
   * Minutes per song, so this is a command you run the night before rather than mid-set.
   *
   * The chain is OPTIONAL and defaults to the machine's — `system stems`. Which module separates
   * and which model it wants is the same answer every time, so it is asked once and kept in
   * preferences.yaml; naming one here is the override, for the run that wants a different model.
   * A chain that treats rather than separates is refused either way, rather than quietly bouncing
   * thirty songs.
   *
   * The songs are the MACHINE's copies, under the médiathèque cache: a deck opens file paths, so
   * what matters is what is on this disk. Writing into that cache is safe — `syncFamily` drops
   * what it once fetched (`heldManifest`), never what it finds beside it.
   *
   * Sequential and resumable: a song whose `stems/` already holds something is skipped, and the
   * separation registry hashes the WORK, so even a re-run of an interrupted pass costs nothing
   * twice. Both halves matter for thirty songs on one machine.
   */
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

    // Resolved against the OPEN PROJECT's module vocabulary, like every other cold step: that is
    // where a `@st0/…` ref becomes a module and a model becomes a path on this machine. The one
    // playlist verb that needs a project, and it says so rather than throwing NO_PROJECT.
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
      // The master is the FIRST audio file in the folder and the scan does not descend — the
      // médiathèque's own rule (`scanSongs`), restated here because this reads the cache directly
      // rather than through a scan of every song on the disk.
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
      // Already done is a question about the FOLDER, not a flag anybody keeps — the same rule
      // every "is this fresh" question in this repo asks. A half-finished pass costs nothing to
      // redo: the registry hashes the work and hands back the run already in flight.
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
        // Per song, and the loop goes on: one unreadable file must not cost the other twenty
        // nine their preparation, and the line says which one it was.
        lines.push(`${item.song}: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    h.log([
      `${found.rel} through '${chain.ref}': ${done} separated` +
        (skipped ? `, ${skipped} already done` : ""),
      ...lines,
    ]);
  },
  /**
   * `playlist song add <playlist> <song> [variant]` — one more line at the end of a set list.
   *
   * The song is the REST of the line, spaces included, because a song's ref is a path through
   * the médiathèque's folders (`AC-DC/Back in Black/Hells Bells`) and asking for quotes around
   * the common case would be asking for them every time. QUOTE it and a variant may follow —
   * one rule, and the only one that can tell "a song with spaces" from "a song and a version".
   *
   * The ref is kept verbatim and nothing checks it: the catalogue is another service's, and a
   * playlist that refused a song you are about to upload would be a playlist you cannot write
   * ahead of a gig. The screen says "morceau introuvable" against the same line, which is where
   * the two listings meet (apps/st0/frontend/docs/playlists.md).
   */
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
    // Null is the file's shape refusing the append — a flow `items: [` spread over lines, say.
    // The same refusal the screen's button wears, and for the same reason: inventing a second
    // `items:` key lower down would write a file whose two halves disagree.
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
