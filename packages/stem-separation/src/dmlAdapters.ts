// dmlAdapters.ts — which DirectML deviceId is a GPU worth running a model on. ORT takes an INDEX
// into DXGI's adapter order and never says what it picked, so the mapping is rebuilt from Windows'
// own DirectX cache in the registry. The one thing to get wrong: the index counts the adapters ORT
// enumerates, which excludes software rasterisers. See docs/stemSplit.md.

import { spawnSync } from "node:child_process";

const CACHE_KEY = "HKLM\\SOFTWARE\\Microsoft\\DirectX";

/** D3DKMT_ADAPTERTYPE bits, the three this file needs — docs/stemSplit.md. */
const SOFTWARE = 0x4;
const POST = 0x8;
const INTEGRATED = 0x20;

/** Below this much dedicated video memory an adapter is integrated whatever its flags say. */
const DISCRETE_VRAM = 1024 * 1024 * 1024;

export interface DxAdapter {
  name: string;
  type: number;
  vram: number;
}

export type DmlChoice =
  | { kind: "adapter"; deviceId: number; name: string }
  | { kind: "unknown" } // nothing legible here: ask for DirectML the way we always did
  | { kind: "integrated-only"; name: string };

/** `reg query … /s` for the adapter cache, one entry per adapter Windows has seen. */
export function parseDirectXCache(text: string): DxAdapter[] {
  const out: DxAdapter[] = [];
  let cur: Partial<DxAdapter> = {};
  const push = () => {
    if (cur.name && cur.type !== undefined)
      out.push({ name: cur.name, type: cur.type, vram: cur.vram ?? 0 });
    cur = {};
  };
  for (const raw of text.split(/\r?\n/)) {
    if (/^HKEY_/.test(raw)) {
      push();
      continue;
    }
    const m = /^\s+(\S+)\s+REG_\w+\s+(.*?)\s*$/.exec(raw);
    if (!m) continue;
    if (m[1] === "Description") cur.name = m[2];
    if (m[1] === "AdapterType") cur.type = Number(m[2]);
    if (m[1] === "DedicatedVideoMemory") cur.vram = Number(m[2]);
  }
  push();
  return out;
}

const isIntegrated = (a: DxAdapter) =>
  (a.type & INTEGRATED) !== 0 || a.vram < DISCRETE_VRAM;

/** DXGI returns the adapter that POSTed first, then the rest — the assumption, said out loud. */
export function chooseAdapter(adapters: DxAdapter[]): DmlChoice {
  // A software rasteriser is not in ORT's enumeration either, so it must not shift the indices.
  const gpus = adapters.filter((a) => (a.type & SOFTWARE) === 0);
  if (!gpus.length) return { kind: "unknown" };
  const post = gpus.findIndex((a) => (a.type & POST) !== 0);
  if (post < 0) return { kind: "unknown" };
  const ordered = [gpus[post], ...gpus.filter((_, i) => i !== post)];
  const at = ordered.findIndex((a) => !isIntegrated(a));
  if (at < 0) return { kind: "integrated-only", name: ordered[0].name };
  return { kind: "adapter", deviceId: at, name: ordered[at].name };
}

/** What this machine's registry says, or `unknown` anywhere the question does not arise. */
export function chooseDmlAdapter(): DmlChoice {
  if (process.platform !== "win32") return { kind: "unknown" };
  try {
    const r = spawnSync("reg", ["query", CACHE_KEY, "/s"], {
      encoding: "latin1",
      timeout: 5000,
      windowsHide: true,
    });
    if (r.status !== 0 || !r.stdout) return { kind: "unknown" };
    return chooseAdapter(parseDirectXCache(r.stdout));
  } catch {
    return { kind: "unknown" };
  }
}
