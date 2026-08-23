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
    // Two adds are almost always a second click on the same row, and a queue playing the same
    // title twice in a row is a fault nobody blames on the click.
    expect(ids(enqueue(q("a", "b"), [song("b")]))).toEqual(["a", "b"]);
  });

  it("rend la MÊME file quand il n'y a rien à ajouter", () => {
    // Identity matters: a new object on every click would re-render the bar for nothing.
    const before = q("a");
    expect(enqueue(before, [song("a")])).toBe(before);
  });
});

describe("removeAt", () => {
  it("retire la ligne visée", () => {
    expect(ids(removeAt(q("a", "b", "c"), 1))).toEqual(["a", "c"]);
  });

  it("ignore un indice hors bornes", () => {
    // Not a fault: it is a click on what has just played and been removed.
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
    // The trap: removing first shifts everything after, so inserting at `to` in the starting list
    // would move one notch short, and the button would look dead.
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
