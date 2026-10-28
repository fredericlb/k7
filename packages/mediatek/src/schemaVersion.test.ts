// A library whose marker a newer k7 wrote is refused before any write; this build's own, an absent
// one and a marker with no version pass. See ../docs/index.md.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkSchemaVersion,
  ensureLayout,
  MARKER,
  MediatekTooNewError,
  SCHEMA_VERSION,
} from "./layout.ts";
import { removeLibrary } from "./testLibrary.ts";
import { makeFolder } from "./write.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mediatek-v-"));
  process.env.STUDIO_MEDIATEK = root;
});
afterEach(async () => {
  delete process.env.STUDIO_MEDIATEK;
  await removeLibrary(root);
});

const marker = (text: string) => writeFileSync(join(root, MARKER), text);

describe("the media library's schema version", () => {
  it("passes an absent library, this build's own and a marker with no version", () => {
    expect(() => checkSchemaVersion()).not.toThrow();
    ensureLayout();
    expect(() => checkSchemaVersion()).not.toThrow();
    marker("# no version\n");
    expect(() => checkSchemaVersion()).not.toThrow();
  });

  it("refuses a newer library with both versions and the update message", () => {
    marker(`version: ${SCHEMA_VERSION + 1}\n`);
    try {
      checkSchemaVersion();
      expect.unreachable();
    } catch (e) {
      const err = e as MediatekTooNewError;
      expect(err).toBeInstanceOf(MediatekTooNewError);
      expect(err.code).toBe("mediatek-too-new");
      expect(err.libraryVersion).toBe(SCHEMA_VERSION + 1);
      expect(err.buildVersion).toBe(SCHEMA_VERSION);
      expect(err.message).toMatch(/newer k7.*update k7 to use it/);
    }
  });

  it("refuses every write into a newer library, through ensureLayout", () => {
    marker(`version: ${SCHEMA_VERSION + 1}\n`);
    expect(() => ensureLayout()).toThrow(MediatekTooNewError);
    expect(() => makeFolder("songs/new")).toThrow(MediatekTooNewError);
  });
});
