// serveLenses.ts — this machine's window, offering the cameras it may open to a second device
// that may not. It runs on the LOOPBACK origin only, which is both the secure context that makes
// getUserMedia possible and the proof we are the machine rather than a guest on its LAN.
// One peer connection per viewer, one stream per LABEL: two tablets on one lens open it once.
// See packages/song/docs/camera.md.

import {
  type Frame,
  ICE,
  readFrame,
  relayUrl,
  sendFrame,
} from "@studio/k7-plugins/video/camera/relay";
import { type Lens, localLens } from "@studio/ui-eyes/camera";
import { tabBridge } from "../tabs/bridge";

/** Reconnect delay after the socket drops, doubling to this — the app restarting is the usual cause. */
const RETRY_MS = 1000;
const RETRY_MAX_MS = 30_000;

/** Is this browser the machine's own window? Loopback is a secure context and nothing else is. */
export function canServeLenses(): boolean {
  const h = window.location.hostname;
  return (
    (h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1") &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** Open a lens at most once per label (a second getUserMedia on one device may be refused), and
 *  COUNT who uses it: the camera is stopped when the last viewer goes, not kept lit for the page's life. */
function lensCache() {
  const open = new Map<string, { lens: Promise<Lens>; users: number }>();
  const stop = (lens: Promise<Lens>) =>
    void lens.then((l) => {
      for (const t of l.stream?.getTracks() ?? []) t.stop();
    });
  return {
    acquire(label: string): Promise<Lens> {
      let held = open.get(label);
      if (!held) {
        const entry = { lens: localLens(label), users: 0 };
        held = entry;
        open.set(label, entry);
        // An ended track is not a lens any more, and a refusal must not be cached as one either.
        void entry.lens.then((l) => {
          const forget = () => {
            if (open.get(label) === entry) open.delete(label);
          };
          for (const t of l.stream?.getTracks() ?? [])
            t.addEventListener("ended", forget);
          if (!l.stream) forget();
        });
      }
      held.users++;
      return held.lens;
    },
    release(label: string): void {
      const held = open.get(label);
      if (!held || --held.users > 0) return;
      open.delete(label);
      stop(held.lens);
    },
    releaseAll(): void {
      for (const held of open.values()) stop(held.lens);
      open.clear();
    },
  };
}

/** Answer every viewer this relay sends us, until the returned function is called.
 *
 * Only while this tab is IN FRONT. Every project tab runs this file, the relay holds one host
 * slot, and a second offer closes the first — whose reconnect then closes the second, once a
 * second for ever. Following the front tab is the same rule the rest of the app already obeys
 * (apps/k7-standalone/docs/tabs.md), and off the desktop there are no tabs and it is always true. */
export function serveLenses(): () => void {
  let ws: WebSocket | null = null;
  let timer = 0;
  let wait = RETRY_MS;
  let stopped = false;
  const peers = new Map<string, RTCPeerConnection>();
  // Which lens each viewer holds, so its leaving lets go of its share.
  const holding = new Map<string, string>();
  const lenses = lensCache();

  const drop = (id: string) => {
    peers.get(id)?.close();
    peers.delete(id);
    const label = holding.get(id);
    holding.delete(id);
    if (label !== undefined) lenses.release(label);
  };

  const answer = async (socket: WebSocket, id: string, label: string) => {
    drop(id);
    holding.set(id, label);
    const lens = await lenses.acquire(label);
    // The socket changed or the tab stepped back while the lens opened: this viewer is gone with it.
    if (socket !== ws || stopped) return drop(id);
    // A sentence and not a negotiation: an offer with no track never fires `ontrack` (docs/camera.md).
    const stream = lens.stream;
    if (!stream) {
      drop(id);
      return sendFrame(socket, {
        type: "problem",
        to: id,
        text: lens.problem ?? "this machine opened no camera",
      });
    }
    const pc = new RTCPeerConnection(ICE);
    peers.set(id, pc);
    for (const t of stream.getTracks()) pc.addTrack(t, stream);
    pc.onicecandidate = (e) => {
      if (e.candidate)
        sendFrame(socket, {
          type: "ice",
          to: id,
          candidate: e.candidate.toJSON(),
        });
    };
    // A viewer that leaves without closing its socket is only noticed here.
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed")
        drop(id);
    };
    const sdp = await pc.createOffer();
    await pc.setLocalDescription(sdp);
    sendFrame(socket, {
      type: "offer",
      to: id,
      sdp: pc.localDescription ?? sdp,
      problem: lens.problem,
    });
  };

  const onFrame = (socket: WebSocket, f: Frame) => {
    if (f.type === "want" && f.from) {
      const id = f.from;
      // Carried rather than thrown: one viewer's refused camera must not close the socket.
      void answer(socket, id, f.label).catch((e: Error) =>
        sendFrame(socket, { type: "problem", to: id, text: e.message }),
      );
      return;
    }
    if (f.type === "answer" && f.from)
      void peers
        .get(f.from)
        ?.setRemoteDescription(f.sdp)
        .catch(() => undefined);
    if (f.type === "ice" && f.from)
      void peers
        .get(f.from)
        ?.addIceCandidate(f.candidate)
        .catch(() => undefined);
    if (f.type === "gone") drop(f.from);
  };

  const connect = () => {
    if (stopped) return;
    const socket = new WebSocket(relayUrl({ role: "host" }));
    ws = socket;
    socket.onopen = () => {
      wait = RETRY_MS;
    };
    socket.onmessage = (e) => {
      // Only the CURRENT socket speaks: an old one's late frames answer viewers it no longer serves.
      if (socket !== ws) return;
      const f = readFrame(e.data);
      if (f) onFrame(socket, f);
    };
    socket.onclose = () => {
      // An old socket's close, landing after a newer one opened, must neither drop its peers nor dial again.
      if (socket !== ws) return;
      ws = null;
      for (const id of [...peers.keys()]) drop(id);
      if (stopped) return;
      timer = window.setTimeout(connect, wait);
      wait = Math.min(wait * 2, RETRY_MAX_MS);
    };
    // An error is followed by a close, which is where the retry lives.
    socket.onerror = () => undefined;
  };

  /** Offer while in front, and go quiet behind — the socket is dropped rather than left idle. */
  const follow = (active: boolean) => {
    if (active === !stopped) return;
    stopped = !active;
    if (active) {
      wait = RETRY_MS;
      connect();
      return;
    }
    clearTimeout(timer);
    for (const id of [...peers.keys()]) drop(id);
    // Forgotten BEFORE it closes: its close event then finds itself stale and dials nothing.
    const closing = ws;
    ws = null;
    closing?.close();
    // Behind, this tab serves no one: the cameras go dark with it.
    lenses.releaseAll();
    holding.clear();
  };

  const bridge = tabBridge();
  stopped = true; // `follow` toggles from here, so the first call always does the connecting
  follow(bridge?.state().active ?? true);
  const unsubscribe = bridge?.subscribe((s) => follow(s.active));

  return () => {
    unsubscribe?.();
    follow(false);
    stopped = true;
  };
}
