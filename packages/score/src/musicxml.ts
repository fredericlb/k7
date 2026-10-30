// musicxml.ts — what the viewer reads off a MusicXML file as text: its parts' names, the same file with
// one part kept, and a compressed `.mxl` opened to the score it holds. Pure, so it is tested alone.
// The one thing a reader would get wrong: an .mxl names its score in META-INF/container.xml, never by a fixed path.

const SCORE_PART =
  /<score-part\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/score-part>/g;
const PART_GROUP =
  /<part-group\b[^>]*\/>|<part-group\b[^>]*>[\s\S]*?<\/part-group>/g;

const decodeEntities = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** Each part's id and name, in score order; a part with no name is "" for the caller to label. */
export function partsOf(xml: string): { id: string; name: string }[] {
  return [...xml.matchAll(SCORE_PART)].map(([, id, body]) => {
    const name = /<part-name\b[^>]*>([\s\S]*?)<\/part-name>/.exec(body)?.[1];
    return { id, name: decodeEntities(name ?? "").trim() };
  });
}

/** The file with one part alone, by index into `partsOf`; an index out of range returns it whole. */
export function keepPart(xml: string, index: number): string {
  const parts = partsOf(xml);
  const kept = parts[index]?.id;
  if (kept === undefined || parts.length < 2) return xml;
  return (
    xml
      .replace(SCORE_PART, (whole, id: string) => (id === kept ? whole : ""))
      // A group bracket names parts that are gone; one part needs no bracket.
      .replace(PART_GROUP, "")
      .replace(
        /<part\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<\/part>/g,
        (whole, id: string) => (id === kept ? whole : ""),
      )
  );
}

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) =>
  (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

/** Whether these bytes are a zip archive, which a compressed MusicXML is. */
export const isZip = (b: Uint8Array): boolean =>
  b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;

/** One entry of the archive's central directory, by name. */
function entries(
  b: Uint8Array,
): Map<string, { method: number; size: number; offset: number }> {
  // The end-of-central-directory record is the last 22 bytes, before an optional comment.
  let end = b.length - 22;
  while (end >= 0 && u32(b, end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a zip archive");
  const out = new Map<
    string,
    { method: number; size: number; offset: number }
  >();
  let at = u32(b, end + 16);
  for (let i = u16(b, end + 10); i > 0; i--) {
    if (u32(b, at) !== 0x02014b50) throw new Error("a broken zip directory");
    const nameLength = u16(b, at + 28);
    const name = new TextDecoder().decode(
      b.subarray(at + 46, at + 46 + nameLength),
    );
    out.set(name, {
      method: u16(b, at + 10),
      size: u32(b, at + 20),
      offset: u32(b, at + 42),
    });
    at += 46 + nameLength + u16(b, at + 30) + u16(b, at + 32);
  }
  return out;
}

async function read(
  b: Uint8Array,
  e: { method: number; size: number; offset: number },
): Promise<string> {
  const start = e.offset + 30 + u16(b, e.offset + 26) + u16(b, e.offset + 28);
  const raw = b.slice(start, start + e.size);
  if (e.method === 0) return new TextDecoder().decode(raw);
  if (e.method !== 8)
    throw new Error(`a zip entry compressed with method ${e.method}`);
  const stream = new Blob([raw])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

/** The score inside a compressed MusicXML, as text. */
export async function unzipMxl(bytes: Uint8Array): Promise<string> {
  const files = entries(bytes);
  const container = files.get("META-INF/container.xml");
  const root = container
    ? /<rootfile\b[^>]*\bfull-path\s*=\s*["']([^"']+)["']/.exec(
        await read(bytes, container),
      )?.[1]
    : undefined;
  // An archive without a container is read by its one score, as other readers do.
  const name =
    root ??
    [...files.keys()].find(
      (n) => !n.startsWith("META-INF/") && /\.(musicxml|xml)$/i.test(n),
    );
  const entry = name ? files.get(name) : undefined;
  if (!entry) throw new Error("no score in this .mxl");
  return read(bytes, entry);
}

/** A score file's bytes as MusicXML text, compressed or not. */
export const musicXmlOf = async (bytes: Uint8Array): Promise<string> =>
  isZip(bytes) ? unzipMxl(bytes) : new TextDecoder().decode(bytes);
