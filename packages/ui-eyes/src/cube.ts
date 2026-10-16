// cube.ts — a `.cube` 3D LUT read into the numbers a 3D texture takes: its edge size and an RGBA
// float per entry, red varying fastest, which is both the file's order and texImage3D's. Pure, so
// a malformed file is refused by a test rather than by a black frame. See docs/luts.md.

/** A 3D LUT ready to upload: `size`³ entries, four floats each, already mapped onto 0..1. */
export interface CubeLut {
  size: number;
  data: Float32Array;
}

/** Parse a `.cube` file; throws naming what is wrong, since a LUT read wrongly is a picture graded wrongly. */
export function parseCube(text: string): CubeLut {
  let size = 0;
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const rows: number[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [key, ...rest] = line.split(/\s+/);
    if (key === "TITLE") continue;
    if (key === "LUT_1D_SIZE")
      throw new Error(
        "a 1D LUT — only a 3D one (LUT_3D_SIZE) grades a picture here",
      );
    if (key === "LUT_3D_SIZE") {
      size = Number(rest[0]);
      continue;
    }
    if (key === "DOMAIN_MIN") {
      min = rest.map(Number);
      continue;
    }
    if (key === "DOMAIN_MAX") {
      max = rest.map(Number);
      continue;
    }
    const v = [key, ...rest].map(Number);
    if (v.length === 3 && v.every(Number.isFinite)) rows.push(v);
  }
  if (!(size >= 2 && size <= 256))
    throw new Error(`LUT_3D_SIZE ${size || "missing"} — expected 2 to 256`);
  if (rows.length !== size ** 3)
    throw new Error(
      `${rows.length} entries for a ${size}³ LUT, which needs ${size ** 3}`,
    );
  const data = new Float32Array(rows.length * 4);
  rows.forEach((r, i) => {
    // A domain other than 0..1 is folded back onto it, which is the range a texture holds.
    for (let c = 0; c < 3; c++) {
      const span = (max[c] as number) - (min[c] as number) || 1;
      data[i * 4 + c] = ((r[c] as number) - (min[c] as number)) / span;
    }
    data[i * 4 + 3] = 1;
  });
  return { size, data };
}
