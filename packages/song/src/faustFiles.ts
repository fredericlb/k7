// faustFiles.ts — which file each `soundfile(...)` slot of a Faust module plays. The program names a
// slot, `soundfile("Table", 1)`; the node fills it with a STRING param of the same name — a Faust knob
// is always a number, so a string can only be a file. `@<library>/…` reads a library's `wavetables/`,
// then its `samples/`; anything else is a path under the project. See docs/faustFiles.md.

import { confineToProject } from "./confine";
import { libraryFile } from "./libraryFiles";
import { wsExists } from "./yaml/workspaceFile";

/** The slot → absolute file map a Faust module's string params make, or undefined when it names none. */
export function faustFilesOf(
  params: Record<string, unknown> | undefined,
  projectDir: string,
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [slot, ref] of Object.entries(params ?? {})) {
    if (typeof ref !== "string" || !ref) continue;
    const file = resolveSoundRef(ref, projectDir);
    if (file !== null) out[slot] = file;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A sound ref as a path; one that resolves nowhere is passed through for the engine's warning, one that escapes is null. */
function resolveSoundRef(ref: string, projectDir: string): string | null {
  if (ref.startsWith("@"))
    return (
      libraryFile("wavetables", ref, projectDir) ??
      libraryFile("samples", ref, projectDir) ??
      ref
    );
  // A ref is text a file holds, so an absolute path or a `..` must not reach past the project's roots (docs/confine.md).
  const abs = confineToProject(projectDir, ref);
  if (!abs) return null;
  return wsExists(abs) ? abs : ref;
}
