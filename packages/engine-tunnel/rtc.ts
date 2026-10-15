// rtc.ts — the engine's end of a WebRTC data channel, answered by the supervisor for a browser
// that cannot reach the engine directly: the offer and answer travel over the tunnel, and the
// channel is then piped to the local engine like any other socket. node-datachannel is NATIVE,
// so it is loaded lazily, and a machine without it declines. See docs/rtc.md.

import { FragmentJoiner, toFragments } from "@studio/web-protocol/rtc-frames";
import { WebSocket } from "ws";

/** The slice of node-datachannel used here, declared rather than imported: the package is OPTIONAL. */
interface DataChannel {
  close(): void;
  isOpen(): boolean;
  sendMessageBinary(buffer: Uint8Array): boolean;
  onMessage(cb: (msg: string | Buffer | ArrayBuffer) => void): void;
  onClosed(cb: () => void): void;
  onError(cb: (err: string) => void): void;
}
interface PeerConnection {
  close(): void;
  setRemoteDescription(sdp: string, type: "offer"): void;
  localDescription(): { sdp: string; type: string } | null;
  onStateChange(cb: (state: string) => void): void;
  onGatheringStateChange(cb: (state: string) => void): void;
  onDataChannel(cb: (dc: DataChannel) => void): void;
}
interface Lib {
  PeerConnection: new (
    name: string,
    config: { iceServers: string[] },
  ) => PeerConnection;
}

let lib: Promise<Lib | null> | null = null;

/** The native library, or null when this machine has none — a decline, never a crash. */
function load(): Promise<Lib | null> {
  const name = "node-datachannel";
  lib ??= import(name)
    .then((m) => ((m as { default?: Lib }).default ?? m) as Lib)
    .catch(() => null);
  return lib;
}

export interface RtcOptions {
  enginePort: number;
  /** STUN/TURN servers; none means host candidates only, which is the local network. */
  iceServers?: string[];
  /** How long ICE gathering may take before the answer goes with what it has. */
  gatherMs?: number;
  log?: (msg: string) => void;
}

/** Peers alive right now, so none is collected while its channel is open. */
const peers = new Set<PeerConnection>();

/** A channel nobody opened within this long is given up. */
const OPEN_WITHIN_MS = 30_000;

/** Answer a browser's offer; the channel it opens is piped to the engine. Throws when this machine cannot. */
export async function answerOffer(
  offer: string,
  opts: RtcOptions,
): Promise<string> {
  const ndc = await load();
  if (!ndc)
    throw new Error(
      "node-datachannel is not installed on the engine's machine",
    );
  const pc = new ndc.PeerConnection("k7-runtime", {
    iceServers: opts.iceServers ?? [],
  });
  peers.add(pc);
  let opened = false;
  const drop = (): void => {
    if (!peers.delete(pc)) return;
    try {
      pc.close();
    } catch {
      /* already closed */
    }
  };
  pc.onStateChange((s) => {
    if (s === "failed" || s === "closed") drop();
  });
  pc.onDataChannel((dc) => {
    opened = true;
    pipe(dc, opts, drop);
  });
  setTimeout(() => {
    if (!opened) drop();
  }, OPEN_WITHIN_MS).unref();
  const gathered = new Promise<void>((res) =>
    pc.onGatheringStateChange((s) => {
      if (s === "complete") res();
    }),
  );
  pc.setRemoteDescription(offer, "offer");
  await Promise.race([
    gathered,
    new Promise((r) => setTimeout(r, opts.gatherMs ?? 2000)),
  ]);
  const answer = pc.localDescription();
  if (!answer?.sdp) {
    drop();
    throw new Error("no local description");
  }
  return answer.sdp;
}

/** One data channel ↔ one engine socket; either end closing closes both, and the peer with them. */
function pipe(dc: DataChannel, opts: RtcOptions, done: () => void): void {
  const engine = new WebSocket(`ws://127.0.0.1:${opts.enginePort}`);
  const joiner = new FragmentJoiner();
  const held: (string | Buffer)[] = [];
  const toEngine = (m: string | Buffer): void => {
    if (engine.readyState === WebSocket.OPEN)
      engine.send(m, { binary: typeof m !== "string" });
    else held.push(m);
  };
  // Guarded both ways: a throw inside a native or socket callback would end the supervisor, so it ends this channel.
  const safely = (fn: () => void): void => {
    try {
      fn();
    } catch (e) {
      opts.log?.(`rtc channel: ${(e as Error).message}`);
      end();
    }
  };
  dc.onMessage((msg) =>
    safely(() => {
      const bytes =
        typeof msg === "string"
          ? Buffer.from(msg)
          : Buffer.from(msg as ArrayBuffer);
      const frame = joiner.push(bytes);
      if (!frame) return;
      toEngine("text" in frame ? frame.text : Buffer.from(frame.binary));
    }),
  );
  engine.on("open", () => {
    for (const m of held.splice(0))
      engine.send(m, { binary: typeof m !== "string" });
  });
  engine.on("message", (data, isBinary) =>
    safely(() => {
      if (!dc.isOpen()) return;
      const payload = isBinary
        ? new Uint8Array(data as Buffer)
        : (data as Buffer).toString("utf8");
      for (const f of toFragments(payload)) dc.sendMessageBinary(f);
    }),
  );
  function end(): void {
    try {
      dc.close();
    } catch {
      /* already closed */
    }
    engine.close();
    done();
  }
  dc.onClosed(end);
  dc.onError((e) => {
    opts.log?.(`rtc channel: ${e}`);
    end();
  });
  engine.on("close", end);
  engine.on("error", () => end());
}
