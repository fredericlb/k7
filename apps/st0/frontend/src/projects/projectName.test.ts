import { describe, expect, it } from "vitest";
import { projectFolderName } from "./projectName";

describe("projectFolderName", () => {
  it("pose le suffixe de l'application choisie", () => {
    // C'est lui, et rien d'autre, qui décide où le projet s'ouvrira.
    expect(projectFolderName("hiver", "l8")).toEqual({
      folder: "hiver.l8",
      error: "",
    });
    expect(projectFolderName("répèt du jeudi", "m9")).toEqual({
      folder: "répèt du jeudi.m9",
      error: "",
    });
  });

  it("ne double pas un suffixe déjà tapé", () => {
    expect(projectFolderName("hiver.l8", "l8").folder).toBe("hiver.l8");
    expect(projectFolderName("hiver.L8", "l8").folder).toBe("hiver.l8");
  });

  it("laisse le MENU décider quand les deux se contredisent", () => {
    // Quelqu'un qui écrit « hiver.l8 » puis choisit m9 a changé d'avis ; « hiver.l8.m9 » ne
    // serait ni l'un ni l'autre.
    expect(projectFolderName("hiver.l8", "m9").folder).toBe("hiver.m9");
    expect(projectFolderName("hiver.m9", "l8").folder).toBe("hiver.l8");
  });

  it("garde un « v1 » qui fait partie du nom", () => {
    // Il n'y a plus de suffixe `.v1` — l'image vit dans une chanson — mais « prise v1 » reste
    // un nom parfaitement ordinaire, et rien ne doit y toucher.
    expect(projectFolderName("prise v1", "l8").folder).toBe("prise v1.l8");
  });

  it("refuse les séparateurs plutôt que de les remplacer en silence", () => {
    // Le file-service en ferait des « _ » — c'est son contrat — mais un écran qui a la place
    // de le dire vaut mieux qu'un dossier apparaissant sous un autre nom que celui qu'on a lu.
    expect(projectFolderName("chansons/hiver", "l8").error).toMatch(/\//);
    expect(projectFolderName("a\\b", "l8").error).toMatch(/\\\\|\\/);
  });

  it("refuse un nom qui commencerait par un point", () => {
    // Le projet existerait sans se voir, ni ici ni dans l'arborescence du dépôt.
    expect(projectFolderName(".caché", "l8").error).toMatch(/point/);
  });

  it("refuse le vide et l'espace seul", () => {
    expect(projectFolderName("", "l8").error).toBeTruthy();
    expect(projectFolderName("   ", "l8").error).toBeTruthy();
    // Et un nom qui n'est QUE le suffixe : il ne resterait rien devant.
    expect(projectFolderName(".l8", "l8").error).toBeTruthy();
  });

  it("garde les espaces et la ponctuation légitimes", () => {
    expect(projectFolderName("Back in Black (démo)", "l8").folder).toBe(
      "Back in Black (démo).l8",
    );
  });
});
