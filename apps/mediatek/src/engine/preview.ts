// preview.ts — one module as a project the engine can load. The smallest document that
// makes a plugin exist: one track, one plugin, no clips. Sending it is what turns "a YAML
// file" into "a loaded plugin that can say what its parameters are".

import {
  emptyDoc,
  enginePlugin,
  pluginDoc,
  trackDoc,
} from "@studio/engine-protocol/build";
import type { ProjectDoc } from "@studio/engine-protocol/project";

/** The chain a preview lives on. One name, so the plugin's id is predictable and the
 *  editor can ask for its parameters without being told. */
export const PREVIEW_CHAIN = "preview";

/**
 * The `plugin:` block of a module file, without a YAML parser.
 *
 * A preview needs two scalars, and pulling a parser into the browser to get them would be
 * a lot of weight for `type` and `name`. Both spellings are read — the indented block and
 * the inline flow map — because module files in this repo use each.
 *
 * Unparseable means undefined, never a throw: the caller then previews a module with no
 * plugin, which is a real thing (an io module) and shows an empty parameter list.
 */
export function readPluginBlock(
  yaml: string,
): { type?: string; name?: string } | undefined {
  // The block form: `plugin:` on its own line, then the indented lines under it.
  const block = /^[ \t]*plugin:[ \t]*\r?\n((?:[ \t]+\S.*\r?\n?)*)/m.exec(yaml);
  const inline = /^[ \t]*plugin:[ \t]*\{([^}]*)\}/m.exec(yaml);
  const body = block?.[1] ?? inline?.[1];
  if (!body) return undefined;
  const field = (k: string): string | undefined =>
    new RegExp(`(?:^|[{,\\s])${k}\\s*:\\s*["']?([^"'\\n,}]+)`)
      .exec(body)?.[1]
      ?.trim();
  const type = field("type");
  const name = field("name");
  return type === undefined && name === undefined ? undefined : { type, name };
}

/** The engine address of the previewed plugin — `chain:module`, its own id scheme. */
export const previewPluginId = (module: string): string =>
  `${PREVIEW_CHAIN}:${module}`;

/**
 * A one-module document.
 *
 * `recordDir` stays empty, which the engine reads as "refuse to arm" — right here, because
 * a preview plays and never records, and a made-up directory would be a lie the engine
 * would eventually try to write into. See emptyDoc.
 */
export function modulePreviewDoc(
  module: string,
  plugin: { type?: unknown; name?: unknown } | undefined,
  params: Record<string, number> = {},
): ProjectDoc {
  const { type, name } = enginePlugin(plugin, module);
  return emptyDoc({
    name: `preview: ${module}`,
    tracks: [
      trackDoc(PREVIEW_CHAIN, {
        name: module,
        plugins: [
          pluginDoc({
            id: previewPluginId(module),
            type,
            name,
            // An instrument, so the engine builds it even with nothing feeding it: an
            // audio effect on a silent track is a plugin the host may not bother to load.
            role: "instrument",
            params,
          }),
        ],
      }),
    ],
  });
}
