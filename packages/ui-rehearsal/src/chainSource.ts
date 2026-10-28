// chainSource.ts — the other session source: a chain of k7's library, played on k7's bench and
// heard HERE. The editor (in an iframe) opens the rig; the recorder finds the engine holding it, subscribes to its
// master broadcast and turns that into the MediaStream the recorder takes — ../docs/chainSource.md.
//
// What reads wrong: the recorder sends the engine no project, only the subscription. It is a second window on
// the BENCH's session, which runs beside the person's song rather than replacing it.

import { EngineClient, type EngineInputDevice } from "@studio/engine-browser";
import { type EngineAccess, engineAccess } from "@studio/engine-browser/access";
import { StreamPlayer } from "@studio/engine-browser/stream";
import { createWorkletSink } from "@studio/engine-browser/stream-sink";
import { SESSIONS, sessionFor } from "@studio/engine-protocol/sessions";
import { decodeStreamFrame } from "@studio/engine-protocol/stream";
import { ENGINE_TOKEN_HEADER, type PublicEngine } from "@studio/web-protocol";
import {
  BENCH_REPO,
  benchProject,
  launchUrl,
} from "@studio/web-protocol/projects";
import { isLoopbackHost } from "@studio/web-protocol/services";
import { ApiError } from "./api";
import {
  type BenchFiles,
  type BenchInput,
  readBenchInputs,
  rememberChannel,
  rememberedChannels,
  setBenchChannel,
} from "./benchInputs";
import { apiBase } from "./config";
import { m } from "./paraglide/messages.js";

// `_what` is the access contract's call name, kept out of a sentence a musician reads.
async function readJson<T>(res: Response, _what: string): Promise<T> {
  if (!res.ok) {
    const said = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(
      said.error ?? m["common.requestFailed"]({ status: res.status }),
      res.status,
    );
  }
  return (await res.json()) as T;
}

// pl8 holds the registry and the account's files: it is the backend this page was served from.
const pl8Base = async (): Promise<string> => apiBase();
let access: Promise<EngineAccess<PublicEngine>> | null = null;
function engines(): Promise<EngineAccess<PublicEngine>> {
  if (!access)
    access = pl8Base().then((base) =>
      engineAccess<PublicEngine>(base, readJson, { hostedFiles: true }),
    );
  return access;
}

/** The frozen chain rehearsals are recorded through, chosen on k7's Frozen chains page; null records from the microphone. */
export async function rehearsalChain(): Promise<string | null> {
  const hub = await (await engines()).hostedFiles();
  // A server holding no files holds no chain either: the microphone it is.
  if (!hub) return null;
  const res = await fetch(`${hub.fileBase}/account/rehearsal-chain`, {
    headers: { [ENGINE_TOKEN_HEADER]: hub.fileToken },
  });
  return (await readJson<{ ref: string | null }>(res, "rehearsal-chain")).ref;
}

/** Where k7 opens the bench seeded with `ref` — what the iframe shows. */
export function benchUrl(ref: string): string {
  return launchUrl(window.location.origin, BENCH_REPO, benchProject(ref), "k7");
}

/** The claim k7 takes on that address, which is how its engine is found. */
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

/** The bench's live inputs and what can feed them; null fields are still being asked. */
export interface ChainInputs {
  /** The interface's inputs as the engine groups them — a stereo pair is ONE device. */
  devices: EngineInputDevice[] | null;
  nodes: BenchInput[] | null;
}

export interface ChainSource {
  /** Feed the bench's input `node` from `channels`, and remember it for this chain. */
  setChannel(node: string, channels: number[]): Promise<void>;
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

/** Listen to the bench k7 opens on `ref`, as `email`, reporting each step through `onPhase`. */
export function openChainSource(
  ref: string,
  email: string,
  onPhase: (p: ChainPhase) => void,
  onInputs?: (i: ChainInputs) => void,
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
  let files: BenchFiles | null = null;
  const inputs: ChainInputs = { devices: null, nodes: null };
  const report = () => onInputs?.({ ...inputs });

  // The bench's graph answers once k7's frame has opened it; what this browser chose for the chain goes back on.
  const loadInputs = async () => {
    const deadline = Date.now() + WAIT_MS;
    while (!closed && files) {
      try {
        const nodes = await readBenchInputs(files);
        const kept = rememberedChannels(ref);
        for (const n of nodes) {
          const want = kept[n.node];
          if (!n.channel && want?.length) {
            await setBenchChannel(files, n.node, want);
            n.channel = want;
          }
        }
        inputs.nodes = nodes;
        return report();
      } catch {
        if (Date.now() > deadline) return;
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    }
  };

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

  const onFrame = (data: ArrayBuffer, owned: boolean) => {
    if (closed) return;
    if (player) {
      player.handle(data, owned);
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
    // The interface's inputs, which an empty meter request answers with (k7's useInputDevices.ts).
    client.onIoLevels((l) => {
      if (!l.devices) return;
      inputs.devices = l.devices;
      report();
    });
    client.broadcast(true);
    client.connect();
    client.ioLevels([]);
    const token = ranked.fileToken ?? ranked.token;
    if (ranked.fileBase && token) {
      files = { fileBase: ranked.fileBase, fileToken: token };
      void loadInputs();
    }
  };

  const source: ChainSource = {
    async setChannel(node, channels) {
      if (!files) throw new Error(m["chain.inputsUnreachable"]());
      await setBenchChannel(files, node, channels);
      rememberChannel(ref, node, channels);
      inputs.nodes =
        inputs.nodes?.map((n) =>
          n.node === node ? { ...n, channel: channels } : n,
        ) ?? null;
      report();
    },
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
