// engine.ts — the browser WebSocket link to the C++ engine: same protocol as the Node
// client, native browser WebSocket, transport + live state, auto-reconnecting. The URL is
// not fixed — the caller picks an engine and passes its probed ws address in. One browser
// implementation, in layers: engineLink.ts (the connection), engineEvents.ts (the frames),
// engineQueries.ts (plugins, presets, pairing), and the transport and project verbs here.

import type { TransportAction } from "@studio/engine-protocol";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { EngineQueries } from "./engineQueries.ts";

export type {
  EngineLoad,
  EngineState,
  ParamMeta,
  PluginLoad,
  PluginParams,
  PresetInfo,
  RecorderState,
  TransportAction,
  WaveformEnvelope,
} from "@studio/engine-protocol";
export type {
  EngineInputDevice,
  IoLevels,
  PluginInfo,
  PluginParamInfo,
} from "@studio/engine-protocol/decode";
export type {
  EnginePluginInfo,
  EnginePluginParam,
  EngineWarning,
  InstrumentStatusCb,
  PairedDevice,
  PairRequest,
} from "./engineEvents.ts";
export type { BeginActivity, EngineUrl, Tally } from "./engineLink.ts";

/** What lets a sound go: a note-off, a note-on at velocity 0, a sustain pedal released, all notes off. */
export function endsANote(data: readonly number[]): boolean {
  const kind = (data[0] ?? 0) & 0xf0;
  const [, a = 0, b = 0] = data;
  if (kind === 0x80) return true;
  if (kind === 0x90) return b === 0;
  if (kind === 0xb0) return (a === 64 && b < 64) || a === 120 || a === 123;
  return false;
}

export class EngineClient extends EngineQueries {
  private broadcasting = false;
  // Active waveform subscriptions, replayed on reconnect like `watched`. Keyed "id:side", COUNTED: two widgets may share a tap.
  private waveformSubs = new Map<
    string,
    { id: string; side: string; count: number }
  >();
  /** The document last handed to the engine, replayed on every open — see docs/reliability.md. */
  private lastProject?: ProjectDoc;

  transport(action: TransportAction): void {
    this.send({ type: "transport", action });
  }
  // A share visitor's mute and solo, which a share's player turns into its own session's tracks; an engine refuses it as unknown.
  trackMix(tracks: { id: string; mute: boolean; solo: boolean }[]): void {
    this.send({ type: "track-mix", tracks });
  }
  // Global record enable, held by the engine and echoed in the state frame, so every surface shows one light.
  setRecordEnabled(on: boolean): void {
    this.send({ type: "record-enable", enabled: on });
  }
  // Scrub the playhead to an absolute position (seconds) — the minimap's click-to-seek.
  seek(seconds: number): void {
    this.send({
      type: "transport",
      action: "seek",
      position: Math.max(0, seconds),
    });
  }
  // The transport loop [start, end) in seconds; the engine wraps playback and starts play from the loop top.
  loop(start: number, end: number, enabled: boolean): void {
    this.send({
      type: "transport",
      action: "loop",
      start: Math.max(0, start),
      end: Math.max(0, end),
      enabled,
    });
  }
  /**
   * Audition ONE note through a track's own chain — the piano roll's click, released by the engine
   * after 100 ms. Sent straight down this socket rather than through the file service, unlike a
   * sample `preview`: there is no path to resolve, only a track the loaded song already names.
   */
  previewNote(track: string, key: number, vel = 1): void {
    // A preview is for now: one heard thirty seconds late, after a reconnect, is not the one that was asked for.
    this.sendNow({
      type: "note-preview",
      track,
      key: Math.max(0, Math.min(127, Math.round(key))),
      vel: Math.max(0, Math.min(1, vel)),
    });
  }
  /** A keyboard PLAYED into a track's chain: one channel message, held until its own note-off — engine/k7-runtime/docs/protocol.md. */
  liveMidi(track: string, data: readonly number[]): void {
    const msg = { type: "midi-live", track, data: [...data] };
    // Played notes are for now and are dropped while the link is down; what ENDS a note is kept, or it would hang.
    if (endsANote(data)) this.send(msg);
    else this.sendNow(msg);
  }
  /**
   * A RECORDER node's two ENGINE verbs. Free-running: neither consults the transport, which is
   * what makes this usable in a rig that never presses play. `on` omitted TOGGLES that node —
   * and that node only. `save` is not here: the engine's job ends at a wav on disk, and sending
   * it anywhere is the file service's, which runs on the machine the file is on.
   * See engine/k7-runtime/docs/recorder.md.
   */
  recorder(node: string, action: "record" | "clear", on?: boolean): void {
    const msg = {
      type: "recorder",
      node,
      action,
      ...(on === undefined ? {} : { on }),
    };
    // A toggle or a clear replayed late does the opposite of now — a second press, a newer take erased — so only a stated `on` waits.
    if (action === "record" && on !== undefined) this.send(msg);
    else this.sendNow(msg);
  }
  /** Apply a project, sent as given and remembered for replay — see docs/reliability.md. */
  sendProject(doc: ProjectDoc): void {
    // Remembered, not just sent: an engine that restarted has no document — see `lastProject`.
    this.lastProject = doc;
    this.send({ type: "project", doc });
  }

  /** Forget the loaded project entirely — plugins, edit and diff baseline — so the next one is built from scratch. */
  flush(): void {
    this.send({ type: "flush" });
  }

  /** Forget a whole SESSION, not just its project; defaults to this client's own — see @studio/engine-protocol/docs/sessions.md. */
  dropSession(session: string = this.session): void {
    this.send({ type: "drop-session", session });
  }

  // Subscribe to a module's waveform: the engine taps the chain and broadcasts envelope points at 20 Hz — see docs/meters.md.
  subscribeWaveform(id: string, side: "input" | "output"): void {
    const key = `${id}:${side}`;
    const sub = this.waveformSubs.get(key);
    if (sub) {
      sub.count++;
      return;
    }
    this.waveformSubs.set(key, { id, side, count: 1 });
    this.send({ type: "subscribe-waveform", id, side });
  }
  // The engine's tap goes with the LAST widget reading it, not the first to unmount.
  unsubscribeWaveform(id: string, side: "input" | "output"): void {
    const key = `${id}:${side}`;
    const sub = this.waveformSubs.get(key);
    if (!sub) return;
    if (--sub.count > 0) return;
    this.waveformSubs.delete(key);
    this.send({ type: "unsubscribe-waveform", id, side });
  }

  /** Turn the master audio broadcast on or off for THIS connection; nothing is sent to a connection that never asked. */
  broadcast(on: boolean): void {
    if (on === this.broadcasting) return;
    this.broadcasting = on;
    this.send({ type: "broadcast", on });
  }

  // Meter the INTERFACE — one peak per channel set, plus the master out; it enables the devices it measures, so ask only while on screen.
  ioLevels(channels: number[][]): void {
    this.send({ type: "io-levels", channels });
  }

  /** The project FIRST: the subscriptions and the queue after it are about a document a restarted engine does not have yet. */
  protected override replay(): void {
    if (this.lastProject)
      this.sendNow({ type: "project", doc: this.lastProject });
    super.replay();
    for (const [, sub] of this.waveformSubs)
      this.send({
        type: "subscribe-waveform",
        id: sub.id,
        side: sub.side,
      });
    // The broadcast subscription lives in the ENGINE, so it is replayed like the others.
    if (this.broadcasting) this.send({ type: "broadcast", on: true });
  }
}
