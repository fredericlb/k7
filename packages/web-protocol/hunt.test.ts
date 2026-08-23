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
    // Both shapes: nobody was sharing, or nobody sent.
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
    // None of these says anything about availability — see docs/hunt.md, especially the SFTP case.
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
    // `exhausted` can stay true from an earlier round; the status is what decides.
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
