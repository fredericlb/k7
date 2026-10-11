// faustFiles.ts — which file each `soundfile(...)` slot of a Faust module plays. The program names a
// slot, `soundfile("Table", 1)`; the node fills it with a STRING param of the same name — a Faust knob
// is always a number, so a string can only be a file. `@<library>/…` reads a library's `wavetables/`,
// then its `samples/`; anything else is a path under the project. See docs/faustFiles.md.

import { existsSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { libraryFile } from "./libraryFiles";

/** The slot → absolute file map a Faust module's string params make, or undefined when it names none. */
export function faustFilesOf(
  params: Record<string, unknown> | undefined,
  projectDir: string,
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [slot, ref] of Object.entries(params ?? {})) {
    if (typeof ref !== "string" || !ref) continue;
    out[slot] = resolveSoundRef(ref, projectDir);
  }
  return Object.keys(out).length ? out : undefined;
}

/** A sound ref as a path; one that resolves nowhere is passed through, so the engine names it in its warning. */
function resolveSoundRef(ref: string, projectDir: string): string {
  if (ref.startsWith("@"))
    return (
      libraryFile("wavetables", ref, projectDir) ??
      libraryFile("samples", ref, projectDir) ??
      ref
    );
  if (isAbsolute(ref)) return ref;
  const abs = resolve(projectDir, ref);
  // Inside the project only: a ref is text a file holds, and `..` must not walk out of it.
  return abs.startsWith(projectDir + sep) && existsSync(abs) ? abs : ref;
}
