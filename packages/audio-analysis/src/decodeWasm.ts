// decodeWasm.ts — an audio file decoded by the WebAssembly build (rust/src/decode.rs), for a host with no ffmpeg and no engine: the phone.
// A reader would get wrong what crosses into the module: not the file, which it reads through `host.read`, a block at a time.
// Decoding is synchronous inside the module, so a block is handed over and the event loop let through between blocks.

import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { extname } from "node:path";
import type { StreamFacts } from "./decode.ts";
import { instantiate, wasmModule } from "./native.ts";

/** Frames per block: about 1.4 s at 48 kHz, a few milliseconds of decoding. */
const BLOCK = 1 << 16;

interface DecodeAbi {
  memory: { buffer: ArrayBuffer };
  dec_hint(len: number): number;
  dec_open(len: number): number;
  dec_rate(): number;
  dec_channels(): number;
  dec_next(frames: number): number;
  dec_frames_ptr(): number;
  dec_error_ptr(): number;
  dec_error_len(): number;
}

/** True when this runtime can run the WebAssembly decoder. */
export function wasmDecodes(): boolean {
  return wasmModule() !== null;
}

/** Decode `source` at its own rate, every channel; `onFrames`' buffer is only valid during the call. */
export async function decodeWithWasm(
  source: string,
  onFrames: (samples: Float32Array, channels: number, frames: number) => void,
  signal?: AbortSignal,
): Promise<StreamFacts> {
  const module = wasmModule();
  if (!module)
    throw new Error("this runtime has no WebAssembly to decode with");
  const fd = openSync(source, "r");
  try {
    let x: DecodeAbi | null = null;
    x = instantiate(module, {
      read(ptr, len, pos) {
        try {
          return readSync(
            fd,
            new Uint8Array((x as DecodeAbi).memory.buffer, ptr, len),
            0,
            len,
            pos,
          );
        } catch {
          return -1;
        }
      },
    }) as DecodeAbi;
    const abi = x;
    const failure = (what: string): Error => {
      const msg = new TextDecoder().decode(
        new Uint8Array(
          abi.memory.buffer,
          abi.dec_error_ptr(),
          abi.dec_error_len(),
        ),
      );
      return new Error(`${what} ${source}: ${msg}`);
    };
    const ext = new TextEncoder().encode(
      extname(source).slice(1).toLowerCase(),
    );
    // The pointer first: allocating may grow the memory, which detaches a buffer taken before.
    const hint = abi.dec_hint(ext.length);
    new Uint8Array(abi.memory.buffer, hint, ext.length).set(ext);
    if (abi.dec_open(fstatSync(fd).size) < 0) throw failure("cannot open");
    const sampleRate = abi.dec_rate();
    const channels = abi.dec_channels();
    let frames = 0;
    for (;;) {
      if (signal?.aborted) throw new Error(`decoding ${source} was aborted`);
      const n = abi.dec_next(BLOCK);
      if (n < 0) throw failure("cannot decode");
      if (n === 0) break;
      const at = abi.dec_frames_ptr();
      onFrames(
        new Float32Array(abi.memory.buffer, at, n * channels),
        channels,
        n,
      );
      frames += n;
      await new Promise((resolve) => setImmediate(resolve));
    }
    return { sampleRate, channels, frames };
  } finally {
    closeSync(fd);
  }
}
