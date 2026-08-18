// resolvePlugin.ts — which plugin a module file actually loads, following `extends`. A face
// declares NOTHING but that ref, so reading the text alone finds no plugin and the engine is
// asked to load nothing. See docs/chainPreview.md.

import { readPluginBlock } from "@studio/engine-protocol/build";
import { engineModuleOf } from "@studio/song/moduleTypes";

/** A plugin as the engine's socket reports it — the only two fields naming one takes. */
export interface ScannedName {
  name: string;
  format: string;
}

/** What `enginePlugin` maps onto the wire. Undefined is "nothing to load", not "silence". */
export type PluginBlock = { type?: string; name?: string } | undefined;

const ENGINE = "@engine/";
const MEDIATEK = "@st0/";

/** How deep an `extends` chain is followed. The measured library reaches two — a module
 *  extending a face extending the scan — and a cycle is caught by the visited set anyway; this
 *  is only there so a pathological file cannot spin. */
const MAX_DEPTH = 8;

/**
 * The ref a module file extends, or "".
 *
 * A regex and not the YAML parser, the same choice `readPluginBlock` makes beside it: this runs
 * on a file being typed into, where the document routinely does not parse, and an answer read a
 * shade loosely beats no answer at all for half the keystrokes.
 */
export function readExtends(yaml: string): string {
  const m = /^[ \t]*extends:[ \t]*(?:"([^"]*)"|'([^']*)'|([^\s#]+))/m.exec(
    yaml,
  );
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
}

/** Where a `@st0/…` ref's own file is, library-relative. "" for anything else. */
export function mediatekModulePath(ref: string): string {
  return ref.startsWith(MEDIATEK)
    ? `modules/${ref.slice(MEDIATEK.length)}/module.yaml`
    : "";
}

/**
 * The plugin an `@engine/…` ref names, out of what a machine has scanned.
 *
 * `engineModuleOf` is the shared rule — the same one `engineCatalogue` applies off disk — so
 * the block built here is byte for byte the one a compiled document would carry.
 */
export function enginePluginFor(
  ref: string,
  plugins: ScannedName[],
): PluginBlock {
  const found = scannedForRef(ref, plugins);
  return found ? (engineModuleOf(found)?.plugin ?? undefined) : undefined;
}

/**
 * The scanned RECORD an `@engine/…` ref names — the plugin, not just how to load it.
 *
 * `enginePluginFor` above answers "what goes in the `plugin:` block", which is the format and
 * the name; asking the engine for a plugin's PARAMETERS needs the scan's `id` as well — the
 * binary's own path, since two plugins can share a display name. Rather than widen that return
 * type, the matching is here and both read it, so there is still one rule for which scanned
 * plugin a ref means.
 *
 * First wins, as the catalogue does: two scans of one plugin are one module.
 */
export function scannedForRef<T extends { name: string; format?: string }>(
  ref: string,
  plugins: readonly T[],
): T | undefined {
  if (!ref.startsWith(ENGINE)) return undefined;
  // The format is passed through but plays no part in the REF — a slug of the name is the
  // whole of it — so a record that carries no format still matches the one it names.
  for (const p of plugins)
    if (engineModuleOf({ name: p.name, format: p.format ?? "" })?.ref === ref)
      return p;
  return undefined;
}

/**
 * The plugin a module file loads, following `extends` as far as the médiathèque and the scan
 * can take it.
 *
 * st0 has no project loader — `resolveModule` needs a ref map built from a workspace, and this
 * app edits a library — so the two levels it CAN see are resolved by hand here: another
 * médiathèque module, read through `readModule`, and the engine's own catalogue, reported over
 * the socket. A bare or `@project/…` ref resolves to nothing, which is honest: no project is
 * open, so there is nowhere to look.
 *
 * The file's OWN `plugin:` block wins at every level. That is what `resolveModule` does too —
 * a module that declares its plugin is not asking to inherit one.
 */
export async function resolvePluginBlock(
  text: string,
  plugins: ScannedName[],
  readModule: (path: string) => Promise<string>,
): Promise<PluginBlock> {
  const seen = new Set<string>();
  let body = text;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const own = readPluginBlock(body);
    if (own) return own;
    const ref = readExtends(body);
    if (!ref) return undefined;
    if (ref.startsWith(ENGINE)) return enginePluginFor(ref, plugins);
    const path = mediatekModulePath(ref);
    if (!path || seen.has(path)) return undefined; // unreachable level, or a cycle
    seen.add(path);
    try {
      body = await readModule(path);
    } catch {
      return undefined; // a ref pointing at nothing — the file says what it says
    }
  }
  return undefined;
}
