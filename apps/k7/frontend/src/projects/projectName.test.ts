import { describe, expect, it } from "vitest";
import {
  droppedStem,
  projectFolderName,
  workspaceFolderName,
} from "./projectName";

describe("projectFolderName", () => {
  it("pose le suffixe de l'application choisie", () => {
    // It, and nothing else, decides where the project will open.
    expect(projectFolderName("hiver", "k7")).toEqual({
      folder: "hiver.k7",
      error: "",
    });
    expect(projectFolderName("répèt du jeudi", "k7")).toEqual({
      folder: "répèt du jeudi.k7",
      error: "",
    });
  });

  it("ne double pas un suffixe déjà tapé", () => {
    expect(projectFolderName("hiver.k7", "k7").folder).toBe("hiver.k7");
    expect(projectFolderName("hiver.K7", "k7").folder).toBe("hiver.k7");
  });

  it("laisse le MENU décider quand les deux se contredisent", () => {
    // Somebody typing 'hiver.z0' and then picking k7 changed their mind; 'hiver.z0.k7' would be neither.
    expect(projectFolderName("hiver.z0", "k7").folder).toBe("hiver.k7");
    expect(projectFolderName("hiver.k7", "z0").folder).toBe("hiver.z0");
  });

  it("garde un « v1 » qui fait partie du nom", () => {
    // `.v1` is not a suffix here — picture lives in a song — so 'prise v1' is an ordinary name nothing must touch.
    expect(projectFolderName("prise v1", "k7").folder).toBe("prise v1.k7");
  });

  it("refuse les séparateurs plutôt que de les remplacer en silence", () => {
    // The file service would turn them into '_', but a screen with room to say so beats a folder under a name nobody read.
    expect(projectFolderName("chansons/hiver", "k7").error).toMatch(/\//);
    expect(projectFolderName("a\\b", "k7").error).toMatch(/\\\\|\\/);
  });

  it("refuse un nom qui commencerait par un point", () => {
    // The project would exist unseen, here and in the workspace's tree alike.
    expect(projectFolderName(".caché", "k7").error).toMatch(/dot/);
  });

  it("refuse le vide et l'espace seul", () => {
    expect(projectFolderName("", "k7").error).toBeTruthy();
    expect(projectFolderName("   ", "k7").error).toBeTruthy();
    // And a name that is ONLY the suffix: nothing would be left in front.
    expect(projectFolderName(".k7", "k7").error).toBeTruthy();
  });

  it("garde les espaces et la ponctuation légitimes", () => {
    expect(projectFolderName("Back in Black (démo)", "k7").folder).toBe(
      "Back in Black (démo).k7",
    );
  });
});

// A workspace is a plain folder: the same refusals, and no suffix on the end.
describe("workspaceFolderName", () => {
  it("ne met aucun suffixe", () => {
    expect(workspaceFolderName("hiver").folder).toBe("hiver");
  });

  it("retire un suffixe déjà tapé — sinon `hiver.k7/` contiendrait `hiver.k7/`", () => {
    expect(workspaceFolderName("hiver.k7").folder).toBe("hiver");
  });

  it("refuse ce que projectFolderName refuse, dans les mêmes mots", () => {
    expect(workspaceFolderName("a/b").error).toBeTruthy();
    expect(workspaceFolderName(".caché").error).toBeTruthy();
    expect(workspaceFolderName("   ").error).toBeTruthy();
    expect(workspaceFolderName(".k7").error).toBeTruthy();
  });
});

// The name a DROPPED project starts on: the file's own, which is nearly always the right one.
describe("droppedStem", () => {
  it("drops the extension and keeps the rest, dots included", () => {
    expect(droppedStem("Winter Sketch.dawproject")).toBe("Winter Sketch");
    expect(droppedStem("v1.2 final.dawproject")).toBe("v1.2 final");
  });

  it("leaves a name with no extension alone", () => {
    expect(droppedStem("winter")).toBe("winter");
  });

  // A dotfile is all extension and no stem, so the field starts EMPTY and the dialog asks — a
  // name beginning with a dot would be a hidden folder, which `workspaceFolderName` refuses anyway.
  it("leaves nothing of a name that is only an extension", () => {
    expect(droppedStem(".dawproject")).toBe("");
    expect(
      projectFolderName(droppedStem(".dawproject"), "k7").error,
    ).toBeTruthy();
  });
});
