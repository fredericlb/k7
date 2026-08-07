import type { MediatekEntry } from "@studio/mediatek/types";
import { describe, expect, it } from "vitest";
import { enqueue, moveTo, type QueueItem, removeAt } from "./queue";

const song = (path: string): MediatekEntry =>
  ({ path, name: path.split("/").pop(), family: "songs" }) as MediatekEntry;

const q = (...paths: string[]): QueueItem[] =>
  paths.map((p) => ({ id: p, entry: song(p) }));

const ids = (queue: QueueItem[]): string[] => queue.map((i) => i.id);

describe("enqueue", () => {
  it("ajoute à la suite, dans l'ordre donné", () => {
    expect(ids(enqueue(q("a"), [song("b"), song("c")]))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("ne remet pas un morceau déjà en attente", () => {
    // Deux « ajouter » sont presque toujours un second clic sur la même ligne, et une file qui
    // joue deux fois le même titre à la suite est un défaut que personne n'attribue au clic.
    expect(ids(enqueue(q("a", "b"), [song("b")]))).toEqual(["a", "b"]);
  });

  it("rend la MÊME file quand il n'y a rien à ajouter", () => {
    // L'identité compte : un nouvel objet à chaque clic ferait re-rendre la barre pour rien.
    const before = q("a");
    expect(enqueue(before, [song("a")])).toBe(before);
  });
});

describe("removeAt", () => {
  it("retire la ligne visée", () => {
    expect(ids(removeAt(q("a", "b", "c"), 1))).toEqual(["a", "c"]);
  });

  it("ignore un indice hors bornes", () => {
    // Ce n'est pas une faute : c'est un clic sur ce qui vient d'être joué et retiré.
    const before = q("a");
    expect(removeAt(before, 3)).toBe(before);
    expect(removeAt(before, -1)).toBe(before);
  });
});

describe("moveTo", () => {
  it("remonte une ligne", () => {
    expect(ids(moveTo(q("a", "b", "c"), 2, 1))).toEqual(["a", "c", "b"]);
  });

  it("descend une ligne — l'indice VOULU dans la liste finale", () => {
    // Le piège : retirer d'abord décale tout ce qui suit, donc insérer à `to` dans la liste
    // de départ ferait un déplacement d'un cran trop court, et le bouton semblerait mort.
    expect(ids(moveTo(q("a", "b", "c"), 0, 1))).toEqual(["b", "a", "c"]);
    expect(ids(moveTo(q("a", "b", "c"), 0, 2))).toEqual(["b", "c", "a"]);
  });

  it("va au bout sans sortir de la liste", () => {
    expect(ids(moveTo(q("a", "b", "c"), 0, 99))).toEqual(["b", "c", "a"]);
    expect(ids(moveTo(q("a", "b", "c"), 2, -5))).toEqual(["c", "a", "b"]);
  });

  it("rend la même file pour un déplacement qui ne déplace rien", () => {
    const before = q("a", "b");
    expect(moveTo(before, 1, 1)).toBe(before);
    expect(moveTo(before, 5, 0)).toBe(before);
  });
});
