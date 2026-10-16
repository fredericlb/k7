// alsDevices.ts — a Live track's devices as plugin refs: racks flattened away, Live's own devices
// reported and skipped, each plugin's hex state decoded into a .vstpreset beside the song.
// Live names no role, so the first plugin on a MIDI track is taken as its instrument — docs/import.md.

import type { MapCtx } from "./ableton.js";
import type { PluginOut } from "./model.js";
import { asArray, bool, num, round, str, textOf, val } from "./xmlAttrs.js";

// Live's own devices carry no portable state, so they are reported and skipped — see docs/import.md.
const NATIVE_DEVICE =
  /Device$|^(Eq8|Compressor2|Reverb|Operator|Wavetable|AutoFilter|Delay|Saturator|Limiter|GlueCompressor|MultibandDynamics|Echo|Roar|Drift|Meld)$/;
const NOT_A_DEVICE = /^(MixerDevice|.*DeviceChain|DevicesListWrapper|Devices)$/;
// Racks are containers: the plugins inside DO cross over, only the rack's own structure is lost.
const RACK_DEVICE = /GroupDevice$/;

export function uniqueName(name: string, used: Set<string>): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let candidate = name;
  for (let n = 2; used.has(candidate); n++) candidate = `${stem}-${n}${ext}`;
  used.add(candidate);
  return candidate;
}

// Live's <Buffer> hex is wrapped across lines and indented; strip everything non-hex before decoding.
function decodeHex(text: string): Uint8Array | null {
  const clean = text.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length < 2) return null;
  const bytes = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  return bytes;
}

// Map a track's Devices to plugin refs; Live gives no explicit instrument/FX role — see docs/import.md.
export function mapDevices(
  devices: any,
  contentType: "audio" | "notes",
  ctx: MapCtx,
): PluginOut[] {
  if (!devices) return [];
  const out: PluginOut[] = [];

  // Walk into racks and flatten them away: only the plugins a rack holds can cross over.
  const found: { tag: string; node: any }[] = [];
  const walk = (node: any): void => {
    if (node == null || typeof node !== "object") return;
    for (const [tag, child] of Object.entries(node)) {
      if (tag.startsWith("@_")) continue;
      if (tag === "PluginDevice" || tag === "AuPluginDevice") {
        for (const d of asArray<any>(child)) found.push({ tag, node: d });
        continue;
      }
      if (!NOT_A_DEVICE.test(tag) && NATIVE_DEVICE.test(tag))
        (RACK_DEVICE.test(tag) ? ctx.racks : ctx.nativeDevices).add(tag);
      if (Array.isArray(child)) for (const c of child) walk(c);
      else walk(child);
    }
  };
  walk(devices);

  for (const { tag, node: d } of found) {
    const desc = d.PluginDesc ?? {};
    const vst3 = desc.Vst3PluginInfo;
    const vst2 = desc.VstPluginInfo;
    const info = vst3 ?? vst2 ?? {};
    const name =
      str(val(info, "Name")) ?? str(val(info, "PlugName")) ?? "unknown plugin";
    const on = val(d, "On", "Manual");
    const plugin: PluginOut = {
      type: tag === "AuPluginDevice" ? "au" : vst3 ? "vst3" : "vst2",
      name,
      enabled: on == null ? true : bool(on),
    };

    // VST3 keeps its state in ProcessorState, VST2 in Preset/VstPreset/Buffer; both are hex text.
    const raw =
      textOf(vst3?.Preset?.Vst3Preset?.ProcessorState) ??
      textOf(vst2?.Preset?.VstPreset?.Buffer);
    if (raw) {
      const bytes = decodeHex(raw);
      if (bytes) {
        const key = `plugins/${uniqueName(`${slug(name)}.vstpreset`, ctx.usedNames)}`;
        ctx.files[key] = bytes;
        plugin.path = key;
      }
    }

    // Live exposes only a SUBSET of the params by name, so paramsComplete is never set — docs/import.md.
    const params: Record<string, number> = {};
    for (const p of asArray<any>(d.ParameterList?.PluginFloatParameter)) {
      const pname = str(val(p, "ParameterName"));
      const pval = val(p, "ParameterValue", "Manual");
      if (pname && pval != null) params[pname] = round(num(pval));
    }
    if (Object.keys(params).length) plugin.params = params;

    plugin.role =
      contentType === "notes" && out.length === 0 ? "instrument" : "audioFX";
    out.push(plugin);
  }
  return out;
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "plugin";
