// chainSource.ts — the third session source: a chain of st0's library, played on st0's bench and
// heard HERE. st0 (in an iframe) opens the rig; k7 finds the engine holding it, subscribes to its
// master broadcast and turns that into the MediaStream the recorder takes — ../docs/chainSource.md.
//
// What reads wrong: k7 sends the engine no project, only the subscription. It is a second window on
// the BENCH's session, which runs beside the person's song rather than replacing it.

import { EngineClient } from "@studio/engine-browser";
import { type EngineAccess, engineAccess } from "@studio/engine-browser/access";
import { StreamPlayer } from "@studio/engine-browser/stream";
import { createWorkletSink } from "@studio/engine-browser/stream-sink";
import { SESSIONS, sessionFor } from "@studio/engine-protocol/sessions";
import { decodeStreamFrame } from "@studio/engine-protocol/stream";
import {
  ENGINE_TOKEN_HEADER,
  type LiveChain,
  type PublicEngine,
} from "@studio/web-protocol";
import {
  BENCH_REPO,
  benchProject,
  launchUrl,
} from "@studio/web-protocol/projects";
import { isLoopbackHost } from "@studio/web-protocol/services";
import { pl8Base } from "./fetchSong/pl8";
import { m } from "./paraglide/messages.js";

async function readJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    const said = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(said.error ?? `${what} ${res.status}`);
  }
  return (await res.json()) as T;
}

// pl8 holds the registry and the account's files; its address is the backend's, asked once.
let access: Promise<EngineAccess<PublicEngine>> | null = null;
function engines(): Promise<EngineAccess<PublicEngine>> {
  if (!access)
    access = pl8Base().then((base) =>
      engineAccess<PublicEngine>(base, readJson, { hostedFiles: true }),
    );
  return access;
}

/** The library's chains, each saying whether the bench can play it live. */
export async function listLiveChains(): Promise<LiveChain[]> {
  const hub = await (await engines()).hostedFiles();
  if (!hub) throw new Error(m["chain.noFiles"]());
  const res = await fetch(`${hub.fileBase}/account/live-chains`, {
    headers: { [ENGINE_TOKEN_HEADER]: hub.fileToken },
  });
  return (await readJson<{ chains: LiveChain[] }>(res, "live-chains")).chains;
}

/** Where st0 opens the bench seeded with `ref` — what the iframe shows. */
export function benchUrl(ref: string): string {
  return launchUrl(
    window.location.origin,
    BENCH_REPO,
    benchProject(ref),
    "st0",
  );
}

/** The claim st0 takes on that address, which is how its engine is found. */
export function benchClaim(ref: string): string {
  return `${BENCH_REPO}/${benchProject(ref)}`;
}

/** The engine holding `claim` for this account, if one does yet. */
export function holderOf(
  list: PublicEngine[],
  claim: string,
  email: string,
): PublicEngine | undefined {
  return list.find((e) =>
    (e.heldProjects ?? []).some(
      (h) => h.project === claim && h.holder === email,
    ),
  );
}

/** Whether a measured address is this machine's own engine, whose output is already in the room. */
export function isLocalEngine(wsUrl: string): boolean {
  try {
    return isLoopbackHost(new URL(wsUrl).hostname);
  } catch {
    return false;
  }
}

export type ChainPhase =
  | { k: "waiting" }
  | { k: "connecting" }
  | { k: "live"; stream: MediaStream; local: boolean }
  | { k: "error"; message: string };

export interface ChainSource {
  /** Peak of the chain's output over the last block, 0..1 — the panel's meter. */
  level(): number;
  /** Play the chain's output on this device too; the recorder takes it either way. */
  setMonitor(on: boolean): void;
  /** Resume the audio context: call from a click, since a context built without one may be held. */
  resume(): void;
  /** Stop listening and let the engine forget this socket. */
  close(): void;
}

const POLL_MS = 1500;
// Long enough for a first bench, which mounts the library before anything plays.
const WAIT_MS = 120_000;

/** Listen to the bench st0 opens on `ref`, as `email`, reporting each step through `onPhase`. */
export function openChainSource(
  ref: string,
  email: string,
  onPhase: (p: ChainPhase) => void,
): ChainSource {
  let closed = false;
  let client: EngineClient | null = null;
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let monitorGain: GainNode | null = null;
  let monitor = false;
  let player: StreamPlayer | null = null;
  let building = false;
  let local = false;
  const buf = new Float32Array(2048);

  // The stream handed to the recorder once live: a failure after that must reach it, or the take records silence.
  let live: MediaStream | null = null;
  const fail = (message: string) => {
    if (closed) return;
    onPhase({ k: "error", message });
    for (const t of live?.getAudioTracks() ?? [])
      t.dispatchEvent(new Event("ended"));
    live = null;
    source.close();
  };

  // The first frame says the rate, and the context has to match it: the sink does not resample.
  const build = async (rate: number, channels: number) => {
    building = true;
    try {
      const c = new AudioContext({
        sampleRate: rate,
        latencyHint: "interactive",
      });
      ctx = c;
      const sink = await createWorkletSink(c, { channels });
      if (closed) return;
      analyser = c.createAnalyser();
      analyser.fftSize = buf.length;
      monitorGain = c.createGain();
      monitorGain.gain.value = monitor ? 1 : 0;
      const dest = c.createMediaStreamDestination();
      sink.node.connect(analyser);
      sink.node.connect(dest);
      sink.node.connect(monitorGain);
      monitorGain.connect(c.destination);
      c.resume().catch(() => {});
      player = new StreamPlayer(sink);
      live = dest.stream;
      onPhase({ k: "live", stream: dest.stream, local });
    } catch (e) {
      fail((e as Error).message);
    } finally {
      building = false;
    }
  };

  const onFrame = (data: ArrayBuffer) => {
    if (closed) return;
    if (player) {
      player.handle(data);
      // A rate change would play at the wrong pitch, into a stream the recorder already holds.
      const f = player.snapshot().format;
      if (f && ctx && f.sampleRate !== ctx.sampleRate)
        fail(m["chain.rateChanged"]());
      return;
    }
    if (building) return;
    const frame = decodeStreamFrame(data);
    if (frame) void build(frame.sampleRate, frame.channels);
  };

  const connect = async () => {
    const acc = await engines();
    const claim = benchClaim(ref);
    const deadline = Date.now() + WAIT_MS;
    let held: PublicEngine | undefined;
    while (!closed && !held) {
      held = holderOf(await acc.list().catch(() => []), claim, email);
      if (held) break;
      if (Date.now() > deadline) return fail(m["chain.neverOpened"]());
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    if (closed || !held) return;
    onPhase({ k: "connecting" });
    const [ranked] = await acc.probe([held]);
    if (closed) return;
    if (!ranked?.wsUrl)
      return fail(m["chain.unreachable"]({ host: held.hostname }));
    local = isLocalEngine(ranked.wsUrl);
    // The bench's own session, beside the song's — @studio/engine-protocol/docs/sessions.md.
    client = new EngineClient(
      acc.linkUrl(ranked),
      undefined,
      sessionFor(SESSIONS.bench, email),
    );
    client.onStreamFrame(onFrame);
    client.broadcast(true);
    client.connect();
  };

  const source: ChainSource = {
    level() {
      if (!analyser) return 0;
      analyser.getFloatTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) if (Math.abs(v) > peak) peak = Math.abs(v);
      return Math.min(1, peak);
    },
    setMonitor(on) {
      monitor = on;
      if (monitorGain) monitorGain.gain.value = on ? 1 : 0;
    },
    resume() {
      ctx?.resume().catch(() => {});
    },
    close() {
      if (closed) return;
      closed = true;
      client?.broadcast(false);
      client?.dispose();
      ctx?.close().catch(() => {});
    },
  };

  onPhase({ k: "waiting" });
  connect().catch((e) => fail((e as Error).message));
  return source;
}
