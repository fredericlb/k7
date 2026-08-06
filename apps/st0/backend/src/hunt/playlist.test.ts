import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureLayout, writablePath } from "@studio/mediatek/layout";
import { parsePlaylist } from "@studio/mediatek/playlist";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addToPlaylist } from "./hunt.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hunt-playlist-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
});

afterEach(() => {
  delete process.env.STUDIO_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
});

const put = (rel: string, text: string): void =>
  writeFileSync(writablePath(rel), text, "utf8");
const read = (rel: string): string => readFileSync(writablePath(rel), "utf8");

describe("addToPlaylist", () => {
  it("ajoute le morceau et rend null quand tout va bien", () => {
    put(
      "playlists/set.yaml",
      "title: Set\nitems:\n  - Nirvana/Nevermind/Breed\n",
    );
    expect(
      addToPlaylist(
        "playlists/set.yaml",
        "songs/AC-DC/Back in Black/Hells Bells",
      ),
    ).toBeNull();
    expect(parsePlaylist(read("playlists/set.yaml"))?.items).toEqual([
      { song: "Nirvana/Nevermind/Breed" },
      { song: "AC-DC/Back in Black/Hells Bells" },
    ]);
  });

  it("écrit une référence relative à songs/, comme le panneau des playlists", () => {
    // Sinon la même playlist tiendrait deux orthographes de la même chose.
    put("playlists/set.yaml", "items: []\n");
    addToPlaylist("playlists/set.yaml", "songs/Nirvana/Nevermind/Lithium");
    expect(read("playlists/set.yaml")).toContain("Nirvana/Nevermind/Lithium");
    expect(read("playlists/set.yaml")).not.toContain("songs/Nirvana");
  });

  it("garde les commentaires : c'est pour ça que l'écriture est textuelle", () => {
    put(
      "playlists/set.yaml",
      "# la répèt du jeudi\ntitle: Répèt\nitems:\n  # on ouvre là-dessus\n  - Nirvana/Nevermind/Breed\n",
    );
    addToPlaylist("playlists/set.yaml", "songs/Nirvana/Nevermind/Lithium");
    const out = read("playlists/set.yaml");
    expect(out).toContain("# la répèt du jeudi");
    expect(out).toContain("  # on ouvre là-dessus");
  });

  it("ne double pas la ligne quand le morceau y est déjà", () => {
    // Une recherche relancée à la main ne doit pas allonger la setlist deux fois.
    put("playlists/set.yaml", "items:\n  - Nirvana/Nevermind/Lithium\n");
    expect(
      addToPlaylist("playlists/set.yaml", "songs/Nirvana/Nevermind/Lithium"),
    ).toBeNull();
    expect(parsePlaylist(read("playlists/set.yaml"))?.items).toHaveLength(1);
  });

  it("dit pourquoi plutôt que de lever, quand la playlist a disparu", () => {
    // Demi-succès : le morceau EST rangé. Faire échouer le téléchargement pour ça enverrait
    // le recommencer, alors qu'il n'y a qu'une ligne à ajouter à la main.
    const why = addToPlaylist("playlists/absente.yaml", "songs/a/b/c");
    expect(why).toMatch(/introuvable/);
  });

  it("refuse une forme d'`items:` qu'il ne sait pas étendre, en le disant", () => {
    // Inventer un deuxième `items:` plus bas ferait un fichier dont les deux moitiés se
    // contredisent — voir packages/mediatek/docs/playlists.md.
    put("playlists/set.yaml", "items: [\n  a,\n]\n");
    expect(addToPlaylist("playlists/set.yaml", "songs/a/b/c")).toMatch(/items/);
    // Et le fichier n'a pas bougé.
    expect(read("playlists/set.yaml")).toBe("items: [\n  a,\n]\n");
  });

  it("refuse un chemin qui sortirait de la médiathèque", () => {
    expect(addToPlaylist("playlists/../../etc/passwd", "songs/a/b/c")).toMatch(
      /refusé|introuvable/,
    );
  });
});
