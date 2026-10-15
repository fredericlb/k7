// An imported archive may not inflate past a ceiling: a few kilobytes of zeros declare gigabytes.

import { gzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { boundedGunzip, boundedUnzip, MAX_INFLATED_BYTES } from "./inflate";

const MiB = 2 ** 20;
const zeros = (n: number) => new Uint8Array(n);

describe("boundedUnzip", () => {
  it("refuses one entry past the ceiling", () => {
    const zip = zipSync({ "project.xml": zeros(2 * MiB) });
    expect(zip.length).toBeLessThan(MiB);
    expect(() => boundedUnzip(zip, MiB)).toThrow(/inflates past 1 MiB/);
  });

  it("refuses entries that pass alone and not together", () => {
    const zip = zipSync({ a: zeros(0.6 * MiB), b: zeros(0.6 * MiB) });
    expect(() => boundedUnzip(zip, MiB)).toThrow(/refused/);
  });

  it("reads an archive under it", () => {
    const zip = zipSync({ a: new Uint8Array([1, 2, 3]) });
    expect(boundedUnzip(zip).a).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("caps at a gibibyte by default", () => {
    expect(MAX_INFLATED_BYTES).toBe(1024 * MiB);
  });
});

describe("boundedGunzip", () => {
  it("refuses a stream whose trailer declares more than the ceiling", () => {
    expect(() => boundedGunzip(gzipSync(zeros(2 * MiB)), MiB)).toThrow(
      /inflates past/,
    );
  });

  it("inflates one under it", () => {
    expect(boundedGunzip(gzipSync(zeros(10))).length).toBe(10);
  });
});
