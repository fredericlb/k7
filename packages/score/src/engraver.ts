// engraver.ts — Verovio, loaded once per page: its 7 MB module is compiled on the first score shown,
// and every score after it reuses the module with a toolkit of its own (../docs/score.md).
// The one thing a reader would get wrong: a toolkit holds ONE loaded file, so the MIDI is taken before the part is cut.

/// <reference path="./verovio.d.ts" />
import { VerovioToolkit } from "verovio/esm";

let module: Promise<unknown> | null = null;

/** A toolkit of its own for one score, the module compiled on the first call. */
export async function engraver(): Promise<VerovioToolkit> {
  module ??= import("verovio/wasm").then((m) => m.default());
  return new VerovioToolkit(await module);
}

/** A base64 MIDI as the bytes a sequencer takes. */
export function midiBytes(base64: string): ArrayBuffer {
  const s = atob(base64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}
