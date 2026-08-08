// baseModules.ts — what a médiathèque module may `extends:`, asked of the chosen engine.
// The refs are DERIVED from its plugin catalogue, exactly as engineCatalogue.ts derives them
// off disk on the machine, so the two spellings cannot drift. See docs/completion.md.

import type {
  EngineClient,
  EngineInputDevice,
  EnginePluginInfo,
} from "@studio/engine-browser";
import { engineRef, slugifyPluginName } from "@studio/song/moduleTypes";
import { useEffect, useRef, useState } from "react";

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

/**
 * The live level of each channel SET asked for, in dB, keyed `"1"` / `"1+2"`.
 *
 * Polled only while `active` — the engine ENABLES the devices it measures, so metering twenty
 * inputs for a menu nobody has open is work on the audio thread for nothing. That is the same
 * reason `io-levels` is request/reply rather than a field on the state frame.
 *
 * This is what turns "which input is my guitar on" from a guess into a glance: on the measured
 * rig, channel 1 reads 0 dB and channels 3–8 sit at the noise floor.
 */
export function useInputLevels(
  client: EngineClient | null,
  connected: boolean,
  sets: number[][],
  active: boolean,
): Record<string, number> {
  const [levels, setLevels] = useState<Record<string, number>>({});
  // Read through a ref so the poll below is not rebuilt every time the array is rebuilt.
  const asked = useRef(sets);
  asked.current = sets;
  useEffect(() => {
    if (!client || !connected || !active) return;
    const off = client.onIoLevels((l) => {
      const next: Record<string, number> = {};
      asked.current.forEach((set, i) => {
        next[set.join("+")] = l.inputs?.[i] ?? -100;
      });
      setLevels(next);
    });
    const tick = () => client.ioLevels(asked.current);
    tick();
    // 8 Hz: fast enough to see a string ring, slow enough that a menu costs nothing.
    const t = setInterval(tick, 125);
    return () => {
      clearInterval(t);
      off();
    };
  }, [client, connected, active]);
  return levels;
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
