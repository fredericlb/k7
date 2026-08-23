import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveInMediatek } from "./machinePlayer.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "machine-player-"));
  process.env.STUDIO_MEDIATEK = root;
  mkdirSync(join(root, "songs", "AC-DC", "Back in Black", "Hells Bells"), {
    recursive: true,
  });
  writeFileSync(
    join(
      root,
      "songs",
      "AC-DC",
      "Back in Black",
      "Hells Bells",
      "original.flac",
    ),
    "x",
  );
  // The file that must never be reachable, right beside the root.
  writeFileSync(join(root, "..", "secret-witness.txt"), "x");
});

afterEach(() => {
  delete process.env.STUDIO_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
  rmSync(join(root, "..", "secret-witness.txt"), { force: true });
});

const SONG = "songs/AC-DC/Back in Black/Hells Bells/original.flac";

describe("resolveInMediatek", () => {
  it("résout un chemin relatif contre la médiathèque de CETTE machine", () => {
    expect(resolveInMediatek(SONG)).toBe(join(root, SONG));
  });

  it("refuse tout ce qui sortirait de la médiathèque", () => {
    // The client sends only relative paths, and that is the guarantee: it can name only what this
    // machine caches. A `..` is an attempt, not a typo.
    for (const nasty of [
      "../secret-witness.txt",
      "songs/../../secret-witness.txt",
      "songs/../..",
    ])
      expect(() => resolveInMediatek(nasty)).toThrow(/hors de la médiathèque/);
  });

  it("refuse un chemin absolu, qui contournerait la racine", () => {
    expect(() => resolveInMediatek("/etc/passwd")).toThrow(/relatif/);
    expect(() => resolveInMediatek("")).toThrow(/relatif/);
  });

  it("refuse ce qui n'est pas là plutôt que de le passer à mpv", () => {
    // mpv would fail anyway, but minutes later and in its own words — whereas "that song is not on
    // this machine" is exactly what should be read.
    expect(() => resolveInMediatek("songs/absent/original.flac")).toThrow(
      /n'est pas sur cette machine/,
    );
  });
});
