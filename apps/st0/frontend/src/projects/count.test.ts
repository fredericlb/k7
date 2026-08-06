import type { RepoProject, RepoSummary } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { projectCount } from "./count";

const project = (path: string): RepoProject => ({ path, app: "l8" });

const repo = (id: string, projects: RepoProject[] | null): RepoSummary =>
  ({
    id,
    name: id,
    label: id,
    uri: `git@h:${id}.git`,
    projects,
  }) as RepoSummary;

describe("projectCount", () => {
  it("compte les projets et non les dépôts", () => {
    // Le bug d'origine : un seul dépôt contenant cinq projets affichait « 1 ».
    const repos = [
      repo("studio", [
        project("chansons/hiver.l8"),
        project("chansons/ete.l8"),
        project("sets/live.m9"),
        project("demos/a.l8"),
        project("demos/b.l8"),
      ]),
    ];
    expect(projectCount(repos)).toBe(5);
  });

  it("additionne à travers les dépôts", () => {
    expect(
      projectCount([
        repo("a", [project("x.l8"), project("y.m9")]),
        repo("b", [project("z.l8")]),
      ]),
    ).toBe(3);
  });

  it("compte zéro pour un miroir jamais lu, sans confondre avec un dépôt vide", () => {
    // `null` veut dire « on ne sait pas encore », `[]` veut dire « aucun ». Les deux valent
    // zéro dans un badge, mais le premier deviendra juste tout seul quelques secondes plus
    // tard — inventer un chiffre en attendant serait une affirmation.
    expect(projectCount([repo("pas-encore", null)])).toBe(0);
    expect(projectCount([repo("vide", [])])).toBe(0);
    expect(
      projectCount([repo("pas-encore", null), repo("a", [project("x.l8")])]),
    ).toBe(1);
  });

  it("compte zéro sans dépôt du tout", () => {
    expect(projectCount([])).toBe(0);
  });
});
