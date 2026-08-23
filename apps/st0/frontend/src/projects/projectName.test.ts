import { describe, expect, it } from "vitest";
import { projectFolderName } from "./projectName";

describe("projectFolderName", () => {
  it("pose le suffixe de l'application choisie", () => {
    // It, and nothing else, decides where the project will open.
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
    // Somebody typing 'hiver.z0' and then picking st0 changed their mind; 'hiver.z0.st0' would be neither.
    expect(projectFolderName("hiver.z0", "st0").folder).toBe("hiver.st0");
    expect(projectFolderName("hiver.st0", "z0").folder).toBe("hiver.z0");
  });

  it("garde un « v1 » qui fait partie du nom", () => {
    // There is no `.v1` suffix any more — picture lives in a song — but 'prise v1' is an ordinary name nothing must touch.
    expect(projectFolderName("prise v1", "st0").folder).toBe("prise v1.st0");
  });

  it("refuse les séparateurs plutôt que de les remplacer en silence", () => {
    // The file service would turn them into '_', but a screen with room to say so beats a folder under a name nobody read.
    expect(projectFolderName("chansons/hiver", "st0").error).toMatch(/\//);
    expect(projectFolderName("a\\b", "st0").error).toMatch(/\\\\|\\/);
  });

  it("refuse un nom qui commencerait par un point", () => {
    // The project would exist unseen, here and in the repository's tree alike.
    expect(projectFolderName(".caché", "st0").error).toMatch(/point/);
  });

  it("refuse le vide et l'espace seul", () => {
    expect(projectFolderName("", "st0").error).toBeTruthy();
    expect(projectFolderName("   ", "st0").error).toBeTruthy();
    // And a name that is ONLY the suffix: nothing would be left in front.
    expect(projectFolderName(".st0", "st0").error).toBeTruthy();
  });

  it("garde les espaces et la ponctuation légitimes", () => {
    expect(projectFolderName("Back in Black (démo)", "st0").folder).toBe(
      "Back in Black (démo).st0",
    );
  });
});
