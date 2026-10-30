import { describe, expect, it } from "vitest";
import { isZip, keepPart, musicXmlOf, partsOf } from "./musicxml";

const SCORE = `<?xml version="1.0"?><score-partwise><part-list>
<part-group type="start" number="1"/><score-part id="P1"><part-name>Piano &amp; voice</part-name></score-part>
<score-part id="P2"><part-name></part-name></score-part><part-group type="stop" number="1"/></part-list>
<part id="P1"><measure number="1"/></part><part id="P2"><measure number="1"/></part></score-partwise>`;

// A zip written by hand: a stored container and a deflated score, as an .mxl export lays them out.
async function zip(files: [string, string, boolean][]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];
  const le = (n: number, bytes: number) =>
    Array.from({ length: bytes }, (_, i) => (n >>> (8 * i)) & 0xff);
  for (const [name, text, deflate] of files) {
    const plain = enc.encode(text);
    const data = deflate
      ? new Uint8Array(
          await new Response(
            new Blob([plain])
              .stream()
              .pipeThrough(new CompressionStream("deflate-raw")),
          ).arrayBuffer(),
        )
      : plain;
    const n = enc.encode(name);
    const offset = local.length;
    const method = deflate ? 8 : 0;
    local.push(
      ...le(0x04034b50, 4),
      20,
      0,
      0,
      0,
      ...le(method, 2),
      0,
      0,
      0,
      0,
      ...le(0, 4),
      ...le(data.length, 4),
      ...le(plain.length, 4),
      ...le(n.length, 2),
      0,
      0,
      ...n,
      ...data,
    );
    central.push(
      ...le(0x02014b50, 4),
      20,
      0,
      20,
      0,
      0,
      0,
      ...le(method, 2),
      0,
      0,
      0,
      0,
      ...le(0, 4),
      ...le(data.length, 4),
      ...le(plain.length, 4),
      ...le(n.length, 2),
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      ...le(offset, 4),
      ...n,
    );
  }
  const end = [
    ...le(0x06054b50, 4),
    0,
    0,
    0,
    0,
    ...le(files.length, 2),
    ...le(files.length, 2),
    ...le(central.length, 4),
    ...le(local.length, 4),
    0,
    0,
  ];
  return new Uint8Array([...local, ...central, ...end]);
}

describe("the parts of a score", () => {
  it("names each part in score order, entities decoded, a nameless one empty", () => {
    expect(partsOf(SCORE)).toEqual([
      { id: "P1", name: "Piano & voice" },
      { id: "P2", name: "" },
    ]);
  });

  it("keeps one part, its declaration and its music, and drops the group brackets", () => {
    const one = keepPart(SCORE, 1);
    expect(partsOf(one).map((p) => p.id)).toEqual(["P2"]);
    expect(one).not.toContain('<part id="P1">');
    expect(one).toContain('<part id="P2">');
    expect(one).not.toContain("part-group");
  });

  it("returns the score whole for an index it does not have", () => {
    expect(keepPart(SCORE, 5)).toBe(SCORE);
  });
});

describe("a compressed score", () => {
  it("reads the score the container names, deflated", async () => {
    const bytes = await zip([
      ["mimetype", "application/vnd.recordare.musicxml", false],
      [
        "META-INF/container.xml",
        '<container><rootfiles><rootfile full-path="song/score.xml"/></rootfiles></container>',
        false,
      ],
      ["song/score.xml", SCORE, true],
    ]);
    expect(isZip(bytes)).toBe(true);
    expect(await musicXmlOf(bytes)).toBe(SCORE);
  });

  it("finds the one score of an archive with no container", async () => {
    expect(await musicXmlOf(await zip([["score.musicxml", SCORE, true]]))).toBe(
      SCORE,
    );
  });

  it("reads plain MusicXML as it is", async () => {
    expect(await musicXmlOf(new TextEncoder().encode(SCORE))).toBe(SCORE);
  });
});
