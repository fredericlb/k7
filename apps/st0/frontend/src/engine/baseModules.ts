// baseModules.ts — what a médiathèque module may `extends:`, asked of the chosen engine.
// The refs are DERIVED from its plugin catalogue, exactly as engineCatalogue.ts derives them
// off disk on the machine, so the two spellings cannot drift. See docs/completion.md.

import type {
  EngineClient,
  EngineInputDevice,
  EnginePluginInfo,
} from "@studio/engine-browser";
import { engineRef, slugifyPluginName } from "@studio/song/moduleTypes";
import { useEffect, useState } from "react";

/**
 * The engine's plugins as module refs — `@engine/neural-amp-modeler`.
 *
 * `slugifyPluginName` and `engineRef` come from `@studio/song/moduleTypes`, the leaf with no
 * `node:fs` in it, which exists so a browser can name an engine module without dragging the
 * scan reader in behind it. Same rules as `engineModules()`: an unsluggable name is skipped,
 * and the first of two scans of one plugin wins.
 *
 * The io modules that catalogue also synthesises (`@engine/IN`, `OUT`, `FILE`) are deliberately
 * absent: they are usable directly and are not `extends` targets.
 */
export function baseModuleRefs(plugins: EnginePluginInfo[]): string[] {
  const refs = new Set<string>();
  for (const p of plugins) {
    const slug = slugifyPluginName(p.name ?? "");
    if (slug) refs.add(engineRef(slug));
  }
  return [...refs].sort();
}

/**
 * The catalogue itself, for the engine this screen is on. Empty while none answers.
 *
 * Asked on every (re)connection rather than once: the catalogue is the MACHINE's, so a
 * different engine has a different one, and a rescan on the machine changes it under us.
 * `listPlugins` reads the engine's cache and starts no scan, so the question is cheap.
 *
 * The whole list and not just the refs, because two things need it and only one of them is
 * completion: resolving `extends: "@engine/…"` into a plugin the engine can be asked to LOAD
 * needs the format beside the name (see resolvePlugin.ts).
 */
export function useEnginePlugins(
  client: EngineClient | null,
  connected: boolean,
): EnginePluginInfo[] {
  const [plugins, setPlugins] = useState<EnginePluginInfo[]>([]);
  useEffect(() => {
    if (!client) return setPlugins([]);
    const off = client.onPlugins(setPlugins);
    if (connected) client.listPlugins();
    return off;
  }, [client, connected]);
  return plugins;
}

/** Two input layouts describing the same rig — name and channels, in order. */
const sameLayout = (a: EngineInputDevice[], b: EngineInputDevice[]): boolean =>
  a.length === b.length &&
  a.every(
    (d, i) =>
      d.name === b[i]?.name &&
      d.channels.join("+") === b[i]?.channels.join("+"),
  );

/**
 * How the open interface GROUPS its inputs — the sets a track can actually be routed from.
 *
 * Not a channel count: `findWaveInput` matches a device whose channel set is exactly the one
 * asked for, so on a rig that pairs its inputs "channel 2" resolves to nothing and reads as
 * silence. The engine rides this layout along on `io-levels` for precisely that reason (see
 * inputChannels.ts, and Recording.cpp's `channelTap`).
 *
 * Asked with an EMPTY channel list: that reply carries the layout regardless, and asking to
 * meter nothing enables nothing — the engine only enables the devices it is told to measure.
 * Re-asked when the interface changes, since the grouping is the interface's.
 */
export function useEngineInputDevices(
  client: EngineClient | null,
  connected: boolean,
): EngineInputDevice[] {
  const [devices, setDevices] = useState<EngineInputDevice[]>([]);
  useEffect(() => {
    if (!client) return setDevices([]);
    const offLevels = client.onIoLevels((l) =>
      // Kept only when the LAYOUT moved. This frame also carries meters, and an I/O panel
      // open elsewhere polls it at 20 Hz — a new array every time would recompute the menu
      // and its labels twenty times a second to say the same thing.
      setDevices((was) => (sameLayout(was, l.devices ?? []) ? was : l.devices)),
    );
    const offDevices = client.onAudioDevices(() => client.ioLevels([]));
    if (connected) {
      client.ioLevels([]);
      client.listAudioDevices();
    }
    return () => {
      offLevels();
      offDevices();
    };
  }, [client, connected]);
  return devices;
}
