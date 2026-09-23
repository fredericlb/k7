import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  missing,
  readSettings,
  saveSettings,
  sftpOf,
  slskdOf,
} from "./store.ts";

const FULL = {
  url: "https://slskd.lan:5031/",
  sftpHost: "slskd.lan",
  sftpPort: 2222,
  sftpUser: "bob",
  downloadsDir: "/downloads/",
  apiKey: "API-KEY",
  sftpKey: "SECRET-KEY-MATERIAL",
};

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pl8-settings-"));
  process.env.STUDIO_SETTINGS_DIR = dir;
  process.env.SESSION_SECRET = "test-secret";
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.STUDIO_SETTINGS_DIR;
});

const onDisk = (): string =>
  readdirSync(dir)
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");

describe("settings store", () => {
  it("dit ce qui manque tant que rien n'est enregistré", () => {
    expect(slskdOf("ann")).toBeNull();
    expect(sftpOf("ann")).toBeNull();
    expect(missing("ann")).toContain("paramètres");
  });

  it("rend les secrets à la recherche, jamais à l'écran", () => {
    saveSettings("ann", FULL);
    expect(missing("ann")).toBeNull();
    expect(slskdOf("ann")).toEqual({
      url: "https://slskd.lan:5031",
      key: "API-KEY",
    });
    expect(sftpOf("ann")).toMatchObject({
      host: "slskd.lan",
      port: 2222,
      privateKey: "SECRET-KEY-MATERIAL",
      downloadsDir: "/downloads",
    });
    const view = readSettings("ann");
    expect(view).toMatchObject({ hasApiKey: true, hasSftpKey: true });
    expect(JSON.stringify(view)).not.toContain("API-KEY");
  });

  it("scelle les secrets dans le fichier", () => {
    saveSettings("ann", FULL);
    expect(onDisk()).not.toContain("API-KEY");
    expect(onDisk()).not.toContain("SECRET-KEY-MATERIAL");
  });

  it("garde un secret omis et oublie un secret vide", () => {
    saveSettings("ann", FULL);
    const { apiKey: _a, sftpKey: _k, ...plain } = FULL;
    saveSettings("ann", { ...plain, sftpKey: "" });
    expect(slskdOf("ann")?.key).toBe("API-KEY");
    expect(sftpOf("ann")?.privateKey).toBeUndefined();
  });

  it("sépare les personnes", () => {
    saveSettings("ann", FULL);
    expect(slskdOf("bob")).toBeNull();
  });

  it("tient un secret qui ne s'ouvre plus pour absent", () => {
    saveSettings("ann", FULL);
    process.env.SESSION_SECRET = "rotated";
    expect(slskdOf("ann")).toBeNull();
    expect(readSettings("ann").hasApiKey).toBe(false);
  });
});
