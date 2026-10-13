// frames.ts — the tunnel's wire: JSON control messages as TEXT frames, and anything carrying
// bytes (a file chunk, a binary engine frame) as a BINARY frame whose first four bytes give the
// length of a JSON header, the payload following it. See docs/tunnel.md.

/** Where the hub listens for supervisors, under the registry's own `/api`. */
export const TUNNEL_PATH = "/api/engine-tunnel";
/** The engine's secret rides in a header, never the query, so no access log keeps it. */
export const TUNNEL_TOKEN_HEADER = "x-studio-engine-token";

/** The server's render machine proves itself with this header: a key the deployment shares, never the engine's token — docs/jobs.md. */
export const TUNNEL_RENDER_KEY_HEADER = "x-studio-render-key";
/** File chunks are cut to this, so one large take never holds the socket for long. */
export const CHUNK_BYTES = 256 * 1024;

/** A directory tree the server shares with a channel, and what the engine's machine calls it. */
export interface TunnelRoot {
  /** The absolute path on the SERVER, POSIX. */
  remote: string;
  /** A folder name under the agent's cache — never a path, so the server cannot aim it anywhere. */
  name: string;
  /** Whether the engine may send files back into it (a take, a plugin snapshot). */
  writable: boolean;
  /** Each top-level folder is a library's own clone, CONTAINED in its real location, which may be a link — docs/tunnel.md. */
  perChild?: boolean;
}

export interface RemoteStat {
  path: string;
  kind: "file" | "dir" | "missing";
  size?: number;
  mtimeMs?: number;
}

/** What a channel carries: frames piped to the engine, or requests the agent answers itself — docs/jobs.md. */
export type ChannelKind = "engine" | "jobs";

/** Hub → agent. */
export type HubMessage =
  | {
      t: "open";
      ch: number;
      roots: TunnelRoot[];
      kind?: ChannelKind;
      /** The server copied every file before naming it (`sync`): frames to the engine are only rewritten. */
      synced?: boolean;
    }
  | { t: "close"; ch: number }
  | { t: "data"; ch: number; text: string }
  | { t: "stat-reply"; req: number; entries: RemoteStat[] }
  | { t: "get-error"; req: number; error: string }
  | { t: "put-reply"; req: number; stat?: RemoteStat; error?: string }
  | { t: "rtc-offer"; req: number; sdp: string };

/** Agent → hub. */
export type AgentMessage =
  | { t: "opened"; ch: number }
  | { t: "close"; ch: number; reason?: string }
  | { t: "data"; ch: number; text: string }
  | { t: "stat"; req: number; ch: number; paths: string[] }
  | { t: "get"; req: number; ch: number; path: string }
  | { t: "rtc-answer"; req: number; sdp?: string; error?: string };

/** Headers of binary frames: engine bytes, a downloaded chunk, an uploaded chunk. */
export type BinaryHeader =
  | { t: "data"; ch: number }
  | { t: "chunk"; req: number; last: boolean }
  | { t: "put"; req: number; ch: number; path: string; last: boolean };

export function encodeBinary(
  header: BinaryHeader,
  payload: Uint8Array,
): Buffer {
  const head = Buffer.from(JSON.stringify(header), "utf8");
  const out = Buffer.allocUnsafe(4 + head.length + payload.length);
  out.writeUInt32BE(head.length, 0);
  head.copy(out, 4);
  Buffer.from(payload.buffer, payload.byteOffset, payload.length).copy(
    out,
    4 + head.length,
  );
  return out;
}

export function decodeBinary(
  frame: Buffer,
): { header: BinaryHeader; payload: Buffer } | null {
  if (frame.length < 4) return null;
  const len = frame.readUInt32BE(0);
  if (4 + len > frame.length) return null;
  try {
    const header = JSON.parse(frame.subarray(4, 4 + len).toString("utf8"));
    return { header, payload: frame.subarray(4 + len) };
  } catch {
    return null;
  }
}

/** A `ws` message as one Buffer, whichever of its three shapes it arrived in. */
export function asBuffer(data: Buffer | ArrayBuffer | Buffer[]): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}
