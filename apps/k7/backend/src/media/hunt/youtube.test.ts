import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { youtubeQuery, ytdlpArgs } from "./youtube.ts";

describe("youtubeQuery", () => {
  it("met l'artiste ET le titre — l'inverse de la recherche Soulseek", () => {
    // A video title reads "Artist - Title", so the artist is in the field being queried.
    expect(
      youtubeQuery({ artist: "Nirvana", title: "Lithium", query: "x" }),
    ).toBe("Nirvana Lithium");
  });

  it("retombe sur ce qui a été tapé quand MusicBrainz n'a rien reconnu", () => {
    // It is all we have, and YouTube is far more forgiving of loose spelling than a catalogue.
    expect(youtubeQuery({ query: "  lady gaga telephon  " })).toBe(
      "lady gaga telephon",
    );
  });
});

describe("ytdlpArgs", () => {
  it("passe la requête comme UN seul argument, jamais comme une commande", () => {
    // The array plus execFile with no shell keeps a `;` or a `$(…)` as characters in a search.
    const nasty = 'lithium"; rm -rf /; echo "';
    const args = ytdlpArgs(nasty, "/tmp/out");
    expect(args[0]).toBe(`ytsearch1:${nasty}`);
    expect(args.filter((a) => a.includes("rm -rf"))).toHaveLength(1);
  });

  it("ne demande qu'un résultat et jamais une playlist", () => {
    const args = ytdlpArgs("nirvana lithium", "/tmp/out");
    expect(args[0].startsWith("ytsearch1:")).toBe(true);
    expect(args).toContain("--no-playlist");
  });

  it("garde le codec de la source plutôt que de le convertir", () => {
    // The served stream is kept: ~130 kbps Opus into mp3 is lossy-to-lossy, and extracting needs ffmpeg.
    const args = ytdlpArgs("x", "/tmp/out");
    expect(args[args.indexOf("--format") + 1]).toBe("bestaudio");
    expect(args).not.toContain("--extract-audio");
    expect(args).not.toContain("mp3");
  });

  it("borne la taille et le temps, et écrit dans le dossier qu'on lui donne", () => {
    const args = ytdlpArgs("x", "/vol/.hunts/tmp/abc");
    expect(args).toContain("--max-filesize");
    expect(args).toContain("--socket-timeout");
    // Built with `join` as production does, or a Windows dev machine's backslashes fail this.
    expect(args[args.indexOf("--output") + 1]).toBe(
      join("/vol/.hunts/tmp/abc", "%(id)s.%(ext)s"),
    );
  });
});
