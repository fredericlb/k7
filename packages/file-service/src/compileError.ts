// compileError.ts — a compile's throw as the wire carries it: the message, and for a project written by
// a newer k7 the code and both levels, so the browser says "update k7" rather than a schema error.
// See packages/song-schema/docs/formatLevel.md.

import { isFormatTooNew } from "@studio/song-schema/formatLevel";
import type { CompileErrorBody, FormatTooNew } from "@studio/web-protocol";

/** The levels of a format refusal, or undefined for any other throw. */
export function formatTooNewOf(e: unknown): FormatTooNew | undefined {
  if (!isFormatTooNew(e)) return undefined;
  return { fileLevel: e.fileLevel, buildLevel: e.buildLevel };
}

/** The 400 body a document route answers a throw with. */
export function compileErrorBody(e: unknown): CompileErrorBody {
  const body: CompileErrorBody = { error: (e as Error).message };
  const tooNew = formatTooNewOf(e);
  if (tooNew) Object.assign(body, { code: "format-too-new", ...tooNew });
  return body;
}
