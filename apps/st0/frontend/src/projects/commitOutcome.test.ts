import { describe, expect, it } from "vitest";
import { commitOutcome } from "./commitOutcome";

describe("commitOutcome", () => {
  it("rend null quand le commit est passé et poussé", () => {
    expect(
      commitOutcome([
        "committed a1b2c3d (4 files) — new project hiver.st0",
        "pushed",
      ]),
    ).toBeNull();
  });

  it("distingue un push raté d'un commit raté", () => {
    // Le commit a eu lieu : ça se rattrape en poussant plus tard, pas en recommençant.
    expect(
      commitOutcome([
        "committed a1b2c3d (4 files) — new project hiver.st0",
        "push failed (commit is local): Permission denied (publickey)",
      ]),
    ).toMatch(/push failed/);
  });

  it("traite comme un ÉCHEC tout ce qui ne prouve pas un commit", () => {
    // Le bug d'origine : la première version cherchait des mots d'échec connus et rendait
    // « succès » pour tout le reste. Le verbe était faux, la commande répondait « unknown
    // command », et l'écran annonçait que tout allait bien — un projet ni committé ni poussé,
    // sans un mot.
    for (const out of [
      ["unknown command: commit new project hiver.st0"],
      ["no repository"],
      ["commit failed: index.lock exists"],
      ["usage: commit <message>"],
      ["no project"],
    ])
      expect(commitOutcome(out)).toBeTruthy();
  });

  it("remonte la sortie brute plutôt qu'un silence", () => {
    // C'est elle qui nommera la prochaine dérive entre ce verbe et commands.yaml.
    expect(commitOutcome(["quelque chose d'inattendu"])).toBe(
      "quelque chose d'inattendu",
    );
    expect(commitOutcome([])).toBeTruthy();
  });

  it("dit pourquoi quand git ne voit rien à committer", () => {
    // Après avoir créé un dossier, « rien à committer » veut dire qu'il est ignoré — un fait
    // utile, pas un succès.
    expect(commitOutcome(["nothing to commit — the project is clean"])).toMatch(
      /ignoré/,
    );
  });
});
