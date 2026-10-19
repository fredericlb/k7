// native.ts — the Rust reader (rust/src/ffi.rs) where this runtime has one: WebAssembly where there is a JIT, an installed addon elsewhere.
// A reader would get wrong that it can change an answer: it only ever answers what parse.ts would, else it declines and parse.ts runs (docs/rust.md).

import { WASM } from "./k7xWasm.generated.ts";
import { K7SyntaxError } from "./parse.ts";

/** What a host's Rust build answers for one text: rust/src/ffi.rs's status, and its JSON. */
export interface K7Reader {
  data(text: string): [status: number, json: string];
}

const OK = 0;
const SYNTAX_ERROR = 1;

interface Abi {
  memory: WebAssembly.Memory;
  k7x_input(len: number): number;
  k7x_data(len: number): number;
  k7x_output_ptr(): number;
  k7x_output_len(): number;
}

/** undefined until the first read tries WebAssembly; null where there is none to run. */
let reader: K7Reader | null | undefined;
let pending: Promise<void> | null = null;

function wasmReader(instance: WebAssembly.Instance): K7Reader {
  const x = instance.exports as unknown as Abi;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return {
    data(text) {
      const cap = text.length * 3;
      const at = x.k7x_input(cap);
      const view = new Uint8Array(x.memory.buffer, at, cap);
      const status = x.k7x_data(encoder.encodeInto(text, view).written);
      const out = new Uint8Array(
        x.memory.buffer,
        x.k7x_output_ptr(),
        x.k7x_output_len(),
      );
      return [status, decoder.decode(out)];
    },
  };
}

function bytes(): Uint8Array<ArrayBuffer> {
  const bin = atob(WASM);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface NodeProcess {
  env?: Record<string, string | undefined>;
  dlopen?: (module: { exports: unknown }, path: string) => void;
}
const proc = (globalThis as { process?: NodeProcess }).process;
let kind: "addon" | "wasm" | "installed" | "none" = "none";

/** The Node-API build of rust/node at `path`: what a node with no WebAssembly runs, NodeMobile on iOS. */
function addonReader(path: string): K7Reader | null {
  try {
    const module = { exports: {} };
    proc?.dlopen?.(module, path);
    kind = "addon";
    return module.exports as K7Reader;
  } catch (e) {
    console.warn(
      `k7x: K7X_ADDON ${path} did not load, parse.ts reads instead`,
      e,
    );
    return null;
  }
}

/** The reader, chosen on first use: K7X_ADDON if set, else WebAssembly, compiled synchronously where the runtime allows it. */
function current(): K7Reader | null {
  if (reader !== undefined) return reader;
  reader = null;
  if (proc?.env?.K7X_READER === "js") return reader;
  const addon = proc?.env?.K7X_ADDON;
  if (addon) {
    reader = addonReader(addon);
    return reader;
  }
  if (typeof WebAssembly !== "object") return reader;
  try {
    reader = wasmReader(
      new WebAssembly.Instance(new WebAssembly.Module(bytes())),
    );
    kind = "wasm";
  } catch {
    // A browser's main thread refuses a synchronous compile past a size; parse.ts answers until the async one lands.
    pending ??= WebAssembly.instantiate(bytes())
      .then(({ instance }) => {
        reader ??= wasmReader(instance);
        kind = "wasm";
      })
      .catch(() => {});
  }
  return reader;
}

/** Which reader this runtime ended up with: a test and a host's log say which one they measured. */
export function nativeKind(): typeof kind {
  current();
  return kind;
}

/** Resolves once the reader is as ready as it will get: a host may await it at boot, nothing needs to. */
export async function nativeReady(): Promise<boolean> {
  current();
  await pending;
  return reader != null;
}

/** Hands this runtime a reader of its own, as the iOS app does with its native build; null goes back to parse.ts. */
export function installReader(r: K7Reader | null): void {
  reader = r;
  kind = r ? "installed" : "none";
}

const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** A file's plain value from the Rust reader; undefined where it has none or declines; throws K7SyntaxError as parse.ts would. */
export function nativeData(text: string): Record<string, unknown> | undefined {
  const r = current();
  if (!r) return undefined;
  const wellFormed = (text as { isWellFormed?: () => boolean }).isWellFormed;
  if (wellFormed ? !wellFormed.call(text) : LONE_SURROGATE.test(text))
    return undefined;
  const [status, json] = r.data(text);
  if (status === OK) return JSON.parse(json) as Record<string, unknown>;
  if (status !== SYNTAX_ERROR) return undefined;
  const e = JSON.parse(json) as {
    message: string;
    offset: number;
    line: number;
    column: number;
  };
  throw new K7SyntaxError(e.message, e.offset, e.line, e.column);
}
