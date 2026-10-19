// bufferReads.ts — what the editor reads off the open buffer beyond its text: is it a slice
// rack, is it an input and on which channels. ONE parse serves all three, and none happens when
// the text cannot hold the keys a read looks for — the substring gates are exact, since a key
// the parser would find is spelled in the text. Rationale: docs/audit.md.

import {
  channelOfDoc,
  ioOfDoc,
  type ModuleDoc,
  parseModuleDoc,
} from "@studio/ui-module-builder/module-ui";
import { slicesOf } from "./sliceSymbols";

export interface BufferReads {
  /** The slice symbols live in this buffer, so the docked slicer's drags have somewhere to write. */
  slices: boolean;
  /** The file's `io` kind (`in`, `out`, …), or null for a module that runs a plugin. */
  io: string | null;
  /** An input's channels as authored, read only when `io` is `in`. */
  channels: number[] | string | null;
}

export const NO_READS: BufferReads = {
  slices: false,
  io: null,
  channels: null,
};

/** Whether the text can carry a key `ioOf` reads: `io` itself, or an `extends` naming a meta module. */
const mayNameIo = (text: string): boolean =>
  /\bio\b/.test(text) || text.includes("extends");

/** The three reads, parsing at most once and only when a gate says a read could answer. */
export function readBuffer(text: string, path: string): BufferReads {
  const wantSlices = text.includes("rack_type");
  const wantIo = mayNameIo(text);
  let doc: ModuleDoc | null = null;
  if (wantSlices || wantIo) doc = parseModuleDoc(text);
  const slices =
    !!doc?.contents && wantSlices && slicesOf(doc.contents, text) != null;
  // A path alone can make a file an input, so the io read runs even when nothing was parsed.
  const io = ioOfDoc(doc, path);
  const channels = io === "in" ? channelOfDoc(doc) : null;
  return { slices, io, channels };
}
