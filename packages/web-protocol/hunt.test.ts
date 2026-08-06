import { describe, expect, it } from "vitest";
import { canFallBackToYoutube, type HuntRecord } from "./hunt.ts";

const row = (p: Partial<HuntRecord>): HuntRecord => ({
  id: "x",
  query: "nirvana lithium",
  status: "failed",
  startedAt: 0,
  ...p,
});

describe("canFallBackToYoutube", () => {
  it("propose le secours quand Soulseek a été interrogé et épuisé", () => {
    // Les deux formes : personne ne partageait, ou personne n'a envoyé.
    expect(
      canFallBackToYoutube(
        row({ exhausted: true, error: "personne ne partage « … »" }),
      ),
    ).toBe(true);
    expect(
      canFallBackToYoutube(
        row({ exhausted: true, error: "10 pairs essayés, aucun n'a envoyé" }),
      ),
    ).toBe(true);
  });

  it("ne le propose PAS pour un échec qui ne vient pas du réseau", () => {
    // Aucun de ceux-là ne dit quoi que ce soit sur la disponibilité du morceau. Pour le
    // dernier surtout : le fichier a bien été téléchargé, c'est le SFTP qui n'a pas su le
    // reprendre — et un fichier YouTube masquerait ce défaut de configuration.
    for (const error of [
      "interrompu par un redémarrage du service",
      "recherche annulée",
      "téléchargé, mais introuvable sur slskd.lan sous /downloads",
      "slskd n'est pas configuré : il faut SLSKD_URL et SLSKD_API_KEY",
      "aucun morceau ne correspond à ce nom",
    ])
      expect(canFallBackToYoutube(row({ error }))).toBe(false);
  });

  it("ne le propose sur aucune ligne qui n'a pas échoué", () => {
    // `exhausted` peut rester vrai d'un tour précédent ; c'est l'état qui décide.
    for (const status of ["searching", "downloading", "done"] as const)
      expect(canFallBackToYoutube(row({ status, exhausted: true }))).toBe(
        false,
      );
  });

  it("reste vrai après un essai YouTube raté, pour qu'on puisse réessayer", () => {
    expect(
      canFallBackToYoutube(
        row({ exhausted: true, via: "youtube", error: "yt-dlp : …" }),
      ),
    ).toBe(true);
  });
});
