import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No temp dir can be made to refuse a rename on POSIX, so the refusal alone is faked.
const fake = { refusals: 0, code: "EPERM", attempts: 0 };

function refuse(from: string, to: string): void {
  fake.attempts++;
  if (fake.refusals <= 0) return;
  fake.refusals--;
  const e: NodeJS.ErrnoException = new Error(
    `${fake.code}: operation not permitted, rename '${from}' -> '${to}'`,
  );
  e.code = fake.code;
  throw e;
}

vi.mock("node:fs/promises", async (importActual) => {
  const real = await importActual<typeof import("node:fs/promises")>();
  return {
    ...real,
    rename: async (from: string, to: string) => {
      refuse(from, to);
      return real.rename(from, to);
    },
  };
});

vi.mock("node:fs", async (importActual) => {
  const real = await importActual<typeof import("node:fs")>();
  return {
    ...real,
    renameSync: (from: string, to: string) => {
      refuse(from, to);
      return real.renameSync(from, to);
    },
  };
});

const { placeFile, placeFileSync, FileHeldError } = await import("./place.ts");

let dir: string;
let tmp: string;
let dest: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mediatek-place-"));
  tmp = join(dir, "original.mp3.part");
  dest = join(dir, "original.mp3");
  Object.assign(fake, { refusals: 0, code: "EPERM", attempts: 0 });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const variants = [
  ["placeFile", (a: string, b: string) => placeFile(a, b)],
  ["placeFileSync", async (a: string, b: string) => placeFileSync(a, b)],
] as const;

describe.each(variants)("%s", (_name, place) => {
  it("renames when nothing holds the name", async () => {
    writeFileSync(tmp, "NEW");
    await place(tmp, dest);
    expect(readFileSync(dest, "utf8")).toBe("NEW");
    expect(existsSync(tmp)).toBe(false);
    expect(fake.attempts).toBe(1);
  });

  it("waits out a scanner that holds the file for a moment", async () => {
    writeFileSync(tmp, "NEW");
    fake.refusals = 3;
    await place(tmp, dest);
    expect(readFileSync(dest, "utf8")).toBe("NEW");
    expect(fake.attempts).toBe(4);
  });

  it("keeps the held file when it already holds the same bytes", async () => {
    writeFileSync(dest, "SAME");
    writeFileSync(tmp, "SAME");
    fake.refusals = 99;
    await place(tmp, dest);
    expect(readFileSync(dest, "utf8")).toBe("SAME");
    expect(existsSync(tmp)).toBe(false);
  });

  it("refuses when the held file is a different one of the same length", async () => {
    writeFileSync(dest, "OLD!");
    writeFileSync(tmp, "NEW!");
    fake.refusals = 99;
    const e = await place(tmp, dest).then(
      () => null,
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(FileHeldError);
    expect(((e as Error).cause as NodeJS.ErrnoException).code).toBe("EPERM");
    expect(readFileSync(dest, "utf8")).toBe("OLD!");
    expect(existsSync(tmp)).toBe(true);
  });

  it("throws anything other than a held name at once, untouched", async () => {
    writeFileSync(tmp, "NEW");
    fake.code = "ENOSPC";
    fake.refusals = 1;
    await expect(place(tmp, dest)).rejects.toThrow(/^ENOSPC/);
    expect(fake.attempts).toBe(1);
  });
});
