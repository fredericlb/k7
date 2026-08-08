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

import {
  PREVIEW_CHAIN,
  previewPluginId,
} from "@studio/ui-chains/modulePreview";

// Re-exported, not redefined, so this module's callers and tests are unchanged by where these
// now live. `readPluginBlock` moved to @studio/engine-protocol/build when m9 wanted the same
// two scalars. The other two moved for a sharper reason: the chain name and the plugin address
// are ALSO what the drawn preview node is built from, and two copies would let the loaded
// plugin and the card claiming to show it drift apart in silence. See ../../docs/modulePreview.md.
export { PREVIEW_CHAIN, previewPluginId, readPluginBlock };

/**
 * A one-module document.
 *
 * `recordDir` stays empty, which the engine reads as "refuse to arm" — right here, because
 * a preview plays and never records, and a made-up directory would be a lie the engine
 * would eventually try to write into. See emptyDoc.
 *
 * `inputChannels` is what makes the preview AUDIBLE from an instrument rather than only
 * visible: the engine wires that physical input to this track and monitors it, so the signal
 * arrives ahead of the module and comes out treated (EngineHost::applyTrackInput). Empty is
 * the ordinary case and costs nothing — the engine reads `monitor` only when there are
 * channels.
 *
 * `monitor: "on"` and not `"auto"`: auto monitors only while the track is ARMED, and nothing
 * here arms anything — `recordDir` is empty precisely so it cannot. On is "let it through
 * whatever the transport is doing", which is what auditioning a module means.
 */
export function modulePreviewDoc(
  module: string,
  plugin: { type?: unknown; name?: unknown } | undefined,
  params: Record<string, number> = {},
  inputChannels: number[] = [],
): ProjectDoc {
  const { type, name } = enginePlugin(plugin, module);
  return emptyDoc({
    name: `preview: ${module}`,
    tracks: [
      trackDoc(PREVIEW_CHAIN, {
        name: module,
        inputChannels,
        monitor: "on",
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
