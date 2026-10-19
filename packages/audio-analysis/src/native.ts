// native.ts — the Rust build of the measure (rust/), where this runtime has one: the app's addon in K7X_ADDON, else WebAssembly.
// A reader would get wrong that it may differ from envelope.ts: native.test.ts holds every array to the JS one, bit for bit (docs/analysis.md).

import type { Correlations, Measured } from "./envelope.ts";
import { WASM } from "./waveformWasm.generated.ts";

/** One file's measure: samples pushed as they are decoded, measured once, then closed. */
export interface NativeMeasure {
  push(samples: Float32Array, channels: number): void;
  measure(aLow: number, aHigh: number): Measured;
  correlations: Correlations;
  close(): void;
}

/** The part of WebAssembly this file uses, typed here so it compiles whatever lib a host's tsconfig names. */
interface WasmApi {
  Module: new (bytes: Uint8Array) => object;
  Instance: new (module: object) => { exports: unknown };
}
const wasm = (globalThis as { WebAssembly?: WasmApi }).WebAssembly;

interface Abi {
  memory: { buffer: ArrayBuffer };
  wf_input(len: number): number;
  wf_push(len: number, channels: number): void;
  wf_measure(aLow: number, aHigh: number): number;
  wf_output_ptr(): number;
  wf_output_len(): number;
  wf_autocorr(len: number, minLag: number, maxLag: number): number;
  wf_reset(): void;
}

/** What rust/node exports for the measure, in the iOS app's addon. */
interface Addon {
  wfReset(): void;
  wfPush(samples: Float32Array, channels: number): void;
  wfMeasure(aLow: number, aHigh: number): [number, Float32Array];
  wfAutocorr(onset: Float32Array, minLag: number, maxLag: number): Float64Array;
}

/** The six arrays of rust/src/ffi.rs's output, in its order. */
function split(out: Float32Array, buckets: number): Measured {
  const at = (i: number) => out.slice(i * buckets, (i + 1) * buckets);
  return {
    peak: at(0),
    rms: at(1),
    low: at(2),
    mid: at(3),
    high: at(4),
    tempo: out.slice(5 * buckets),
  };
}

let compiled: object | null | undefined;
let addon: Addon | null | undefined;
let kind: "addon" | "wasm" | "none" = "none";

interface NodeProcess {
  env?: Record<string, string | undefined>;
  dlopen?: (module: { exports: unknown }, path: string) => void;
}
const proc = (globalThis as { process?: NodeProcess }).process;

function loadAddon(path: string): Addon | null {
  try {
    const module = { exports: {} as Partial<Addon> };
    proc?.dlopen?.(module, path);
    return typeof module.exports.wfMeasure === "function"
      ? (module.exports as Addon)
      : null;
  } catch {
    return null;
  }
}

function wasmMeasure(module: object): NativeMeasure {
  let x: Abi | null = new (wasm as WasmApi).Instance(module)
    .exports as unknown as Abi;
  const abi = (): Abi => {
    if (!x) throw new Error("waveform: measure used after close()");
    return x;
  };
  const write = (data: Float32Array): number => {
    const a = abi();
    const at = a.wf_input(data.length);
    new Float32Array(a.memory.buffer, at, data.length).set(data);
    return data.length;
  };
  return {
    push(samples, channels) {
      abi().wf_push(write(samples), channels);
    },
    measure(aLow, aHigh) {
      const a = abi();
      const buckets = a.wf_measure(aLow, aHigh);
      const out = new Float32Array(
        a.memory.buffer,
        a.wf_output_ptr(),
        a.wf_output_len(),
      );
      return split(out, buckets);
    },
    correlations(onset, minLag, maxLag) {
      const a = abi();
      const at = a.wf_autocorr(write(onset), minLag, maxLag);
      return new Float64Array(a.memory.buffer, at, maxLag - minLag + 1).slice();
    },
    close() {
      // The instance and its memory go with it: a two-hour file grows that memory past a gigabyte.
      x = null;
    },
  };
}

function addonMeasure(a: Addon): NativeMeasure {
  a.wfReset();
  return {
    push: (samples, channels) => a.wfPush(samples, channels),
    measure(aLow, aHigh) {
      const [buckets, out] = a.wfMeasure(aLow, aHigh);
      return split(out, buckets);
    },
    correlations: (onset, minLag, maxLag) =>
      a.wfAutocorr(onset, minLag, maxLag),
    close: () => a.wfReset(),
  };
}

/** A measure for one file from the Rust build, or null where this runtime has none (envelope.ts measures then). */
export function openMeasure(): NativeMeasure | null {
  if (proc?.env?.STUDIO_WAVEFORM === "js") return null;
  const path = proc?.env?.K7X_ADDON;
  if (path) {
    addon ??= loadAddon(path);
    if (addon) {
      kind = "addon";
      return addonMeasure(addon);
    }
  }
  if (compiled === undefined) {
    try {
      compiled = wasm ? new wasm.Module(Buffer.from(WASM, "base64")) : null;
    } catch {
      // A JIT-less V8 has no WebAssembly: the JS measure runs instead.
      compiled = null;
    }
  }
  if (!compiled) return null;
  kind = "wasm";
  return wasmMeasure(compiled);
}

/** Which build the last measure ran on: what a test and a log say they measured. */
export function measureKind(): typeof kind {
  return kind;
}
