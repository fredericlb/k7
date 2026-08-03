// preview.ts — one module as a project the engine can load. The smallest document that
// makes a plugin exist: one track, one plugin, no clips. Sending it is what turns "a YAML
// file" into "a loaded plugin that can say what its parameters are".

import {
  emptyDoc,
  enginePlugin,
  pluginDoc,
  readPluginBlock,
  trackDoc,
} from "@studio/engine-protocol/build";

import type { ProjectDoc } from "@studio/engine-protocol/project";

// Re-exported, not redefined: it moved to @studio/engine-protocol/build when platines
// wanted the same two scalars. Kept named here so this module's callers and its tests are
// unchanged by where it now lives.
export { readPluginBlock };

/** The chain a preview lives on. One name, so the plugin's id is predictable and the
 *  editor can ask for its parameters without being told. */
export const PREVIEW_CHAIN = "preview";

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
