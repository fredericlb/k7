import { describe, expect, it } from "vitest";
import { projectFolderName } from "./projectName";

describe("projectFolderName", () => {
  it("pose le suffixe de l'application choisie", () => {
    // C'est lui, et rien d'autre, qui décide où le projet s'ouvrira.
    expect(projectFolderName("hiver", "st0")).toEqual({
      folder: "hiver.st0",
      error: "",
    });
    expect(projectFolderName("répèt du jeudi", "st0")).toEqual({
      folder: "répèt du jeudi.st0",
      error: "",
    });
  });

  it("ne double pas un suffixe déjà tapé", () => {
    expect(projectFolderName("hiver.st0", "st0").folder).toBe("hiver.st0");
    expect(projectFolderName("hiver.ST0", "st0").folder).toBe("hiver.st0");
  });

  it("laisse le MENU décider quand les deux se contredisent", () => {
    // Quelqu'un qui écrit « hiver.z0 » puis choisit st0 a changé d'avis ; « hiver.z0.st0 » ne
    // serait ni l'un ni l'autre. Le cas se rencontrait surtout entre `.st0` et `.m9`, avant
    // qu'un set redevienne une forme de projet st0 plutôt qu'un dossier à part.
    expect(projectFolderName("hiver.z0", "st0").folder).toBe("hiver.st0");
    expect(projectFolderName("hiver.st0", "z0").folder).toBe("hiver.z0");
  });

  it("garde un « v1 » qui fait partie du nom", () => {
    // Il n'y a plus de suffixe `.v1` — l'image vit dans une chanson — mais « prise v1 » reste
    // un nom parfaitement ordinaire, et rien ne doit y toucher.
    expect(projectFolderName("prise v1", "st0").folder).toBe("prise v1.st0");
  });

  it("refuse les séparateurs plutôt que de les remplacer en silence", () => {
    // Le file-service en ferait des « _ » — c'est son contrat — mais un écran qui a la place
    // de le dire vaut mieux qu'un dossier apparaissant sous un autre nom que celui qu'on a lu.
    expect(projectFolderName("chansons/hiver", "st0").error).toMatch(/\//);
    expect(projectFolderName("a\\b", "st0").error).toMatch(/\\\\|\\/);
  });

  it("refuse un nom qui commencerait par un point", () => {
    // Le projet existerait sans se voir, ni ici ni dans l'arborescence du dépôt.
    expect(projectFolderName(".caché", "st0").error).toMatch(/point/);
  });

  it("refuse le vide et l'espace seul", () => {
    expect(projectFolderName("", "st0").error).toBeTruthy();
    expect(projectFolderName("   ", "st0").error).toBeTruthy();
    // Et un nom qui n'est QUE le suffixe : il ne resterait rien devant.
    expect(projectFolderName(".st0", "st0").error).toBeTruthy();
  });

  it("garde les espaces et la ponctuation légitimes", () => {
    expect(projectFolderName("Back in Black (démo)", "st0").folder).toBe(
      "Back in Black (démo).st0",
    );
  });
});
