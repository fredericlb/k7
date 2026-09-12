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
    // The commit happened: it is recovered by pushing later, not by starting over.
    expect(
      commitOutcome([
        "committed a1b2c3d (4 files) — new project hiver.st0",
        "push failed (commit is local): Permission denied (publickey)",
      ]),
    ).toMatch(/push failed/);
  });

  it("tait le push raté d'un espace jamais publié — c'est son état normal", () => {
    // A workspace with no remote CANNOT push; saying so on every commit would make it read as broken.
    expect(
      commitOutcome(
        [
          "committed a1b2c3d (4 files) — new project hiver.st0",
          "push failed (commit is local): No configured push destination.",
        ],
        { noRemote: true },
      ),
    ).toBeNull();
    // …and the commit itself is still judged the same way: `noRemote` excuses the push, nothing else.
    expect(commitOutcome(["no repository"], { noRemote: true })).toBeTruthy();
  });

  it("traite comme un ÉCHEC tout ce qui ne prouve pas un commit", () => {
    // The original bug: looking for known failure words meant 'unknown command' read as a success, and a project was neither committed nor pushed.
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
    // It is what will name the next drift between this verb and commands.yaml.
    expect(commitOutcome(["quelque chose d'inattendu"])).toBe(
      "quelque chose d'inattendu",
    );
    expect(commitOutcome([])).toBeTruthy();
  });

  it("dit pourquoi quand git ne voit rien à committer", () => {
    // After creating a folder, 'nothing to commit' means it is ignored — a useful fact, not a success.
    expect(commitOutcome(["nothing to commit — the project is clean"])).toMatch(
      /ignored/,
    );
  });
});
