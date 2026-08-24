// Field decoders for Grist wire values. Grist returns JSON-decoded values:
// strings, numbers, bools, null, or arrays of the form ["L", …] for
// ChoiceList / Attachments / RefList cells.

export function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function asInt(v: unknown): number {
  return typeof v === "number" ? Math.trunc(v) : 0;
}

export function asFloat(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

export function asBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v === "true" || v === "1";
  return false;
}

/** Null for an unset cell, so a nullable Int tells "missing" from "explicitly set". */
export function optInt(v: unknown): number | null {
  return typeof v === "number" ? Math.trunc(v) : null;
}

/** Decode Grist's ["L", v1, v2, …] ChoiceList format into a flat string[]. */
export function parseChoiceList(v: unknown): string[] {
  if (!Array.isArray(v) || v.length < 2 || v[0] !== "L") return [];
  const out = v
    .slice(1)
    .filter((s): s is string => typeof s === "string" && s !== "");
  return out;
}

/** A RefList cell as row ids, in order — which is how every child collection is ordered. */
export function parseRefList(v: unknown): number[] {
  if (!Array.isArray(v) || v.length < 2 || v[0] !== "L") return [];
  const out: number[] = [];
  for (const raw of v.slice(1)) {
    const id = asInt(raw);
    if (id > 0) out.push(id);
  }
  return out;
}

/** First attachment id stored in an Attachments cell, or null. */
export function firstAttachmentId(v: unknown): number | null {
  const ids = parseRefList(v);
  return ids.length > 0 ? ids[0] : null;
}

/** Pull every non-zero fx_<name> column off a Songs row into an effects map. */
export function parseEffects(
  fields: Record<string, unknown>,
): Record<string, number> | undefined {
  let out: Record<string, number> | undefined;
  for (const [k, v] of Object.entries(fields)) {
    if (!k.startsWith("fx_")) continue;
    const n = asInt(v);
    if (n === 0) continue;
    out ??= {};
    out[k.slice(3)] = n;
  }
  return out;
}

// Folded so slugify keeps a French title readable: "Édith Piaf" → "edith_piaf".
const ASCII_FOLD: Record<string, string> = {
  à: "a",
  á: "a",
  â: "a",
  ä: "a",
  ã: "a",
  å: "a",
  è: "e",
  é: "e",
  ê: "e",
  ë: "e",
  ì: "i",
  í: "i",
  î: "i",
  ï: "i",
  ò: "o",
  ó: "o",
  ô: "o",
  ö: "o",
  õ: "o",
  ø: "o",
  ù: "u",
  ú: "u",
  û: "u",
  ü: "u",
  ý: "y",
  ÿ: "y",
  ñ: "n",
  ç: "c",
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ð: "d",
  þ: "th",
  ł: "l",
  đ: "d",
};

/** A filesystem-safe token: alphanumerics through, everything else one underscore, 60 chars max. */
export function slugify(s: string): string {
  let folded = "";
  for (const ch of s.toLowerCase()) folded += ASCII_FOLD[ch] ?? ch;
  let out = "";
  let lastUnderscore = true;
  for (const ch of folded) {
    if ((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9")) {
      out += ch;
      lastUnderscore = false;
    } else if (!lastUnderscore) {
      out += "_";
      lastUnderscore = true;
    }
  }
  out = out.replace(/^_+|_+$/g, "");
  if (out.length > 60) out = out.slice(0, 60).replace(/_+$/g, "");
  return out;
}

// A track with `from` and no `to`, long enough to cover the reveal phase with slack.
export const DEFAULT_TRIM_DURATION_SEC = 90;

/** The filename AND the ffmpeg call both go through here, so an open-ended track caches once. */
export function resolveTrim(fromSec: number, toSec: number): [number, number] {
  if (toSec <= fromSec) return [fromSec, fromSec + DEFAULT_TRIM_DURATION_SEC];
  return [fromSec, toSec];
}

/** The cache name: `{artist}-{title}-s{songID}-{fromMs}-{toMs}-{ident-stem}.webm`. */
export function buildAudioFilename(
  songId: number,
  artist: string,
  title: string,
  fromSec: number,
  toSec: number,
  ident: string,
): string {
  [fromSec, toSec] = resolveTrim(fromSec, toSec);
  const dot = ident.lastIndexOf(".");
  const identStem = dot > 0 ? ident.slice(0, dot) : ident;
  const parts: string[] = [];
  const a = slugify(artist);
  if (a) parts.push(a);
  const t = slugify(title);
  if (t) parts.push(t);
  if (songId > 0) parts.push(`s${songId}`);
  parts.push(`${Math.trunc(fromSec * 1000)}-${Math.trunc(toSec * 1000)}`);
  parts.push(identStem);
  return parts.join("-") + ".webm";
}
