// engineQueries.ts — the questions a surface asks the engine about plugins, presets, parameters
// and instruments, and the machine's pairing verbs. The answers arrive through engineEvents.ts.
// See docs/params.md and docs/pairing.md.

import { EngineEvents } from "./engineEvents.ts";

export abstract class EngineQueries extends EngineEvents {
  // Plugins we asked to follow, replayed on every open, and COUNTED: the graph leaving must not silence the mastering strip's.
  private watched = new Map<string, number>();

  // The CACHED plugin catalogue (no scanning). Reply arrives on onPlugins.
  listPlugins(): void {
    this.send({ type: "list-plugins" });
  }
  /** Every parameter of one INSTALLED plugin, by `format` and catalogue `id`; SLOW, and externals only — see docs/params.md. */
  listPluginParams(format: string, id: string): void {
    this.send({ type: "list-plugin-params", format, id });
  }

  /** Whether each sampled instrument `refs` names is on the engine's machine; answered on onInstrumentStatus, to this socket only. */
  instrumentStatus(refs: string[]): void {
    this.sendNow({ type: "instrument-status", refs });
  }

  getPluginParams(id: string): void {
    this.send({ type: "get-plugin-params", id });
  }
  // Follow a plugin's values live, idempotent and replayed; unwatch what scrolls away, since each watch costs a read per frame.
  watchPluginParams(id: string, on = true): void {
    const n = this.watched.get(id) ?? 0;
    // Only the first watcher and the last one leaving reach the engine; the ones between are counted here.
    if (on) {
      this.watched.set(id, n + 1);
      if (n === 0) this.send({ type: "watch-plugin-params", id, on: true });
      return;
    }
    if (n === 0) return;
    if (n > 1) return void this.watched.set(id, n - 1);
    this.watched.delete(id);
    this.send({ type: "watch-plugin-params", id, on: false });
  }
  // Set one parameter live WITHOUT persisting — the drag path. Nothing is echoed back, which would fight the drag.
  setPluginParam(id: string, name: string, value: number): void {
    this.send({ type: "set-plugin-param", id, name, value });
  }
  // Ask what presets a module's plugin offers; the answer arrives on onPresets. Empty for a built-in.
  listPresets(module: string): void {
    this.send({ type: "list-presets", module });
  }
  // Apply a preset and persist it to the module's .vstpreset: `sel.path` picks a file, else `sel.index` a program.
  setPreset(module: string, sel: { index?: number; path?: string }): void {
    this.send({
      type: "set-preset",
      module,
      index: sel.index ?? -1,
      path: sel.path ?? "",
    });
  }

  /** The plugins followed, after whatever the layer above replays first. */
  protected override replay(): void {
    for (const id of this.watched.keys())
      this.send({ type: "watch-plugin-params", id, on: true });
  }

  // The machine's own clients only: the engine refuses these over the LAN, a paired phone included (docs/pairing.md).
  listPairRequests(): void {
    this.send({ type: "list-pair-requests" });
  }
  approvePairing(requestId: string): void {
    this.send({ type: "pair-approve", requestId });
  }
  denyPairing(requestId: string): void {
    this.send({ type: "pair-deny", requestId });
  }
  listPairedDevices(): void {
    this.send({ type: "list-paired-devices" });
  }
  unpairDevice(deviceId: string): void {
    this.send({ type: "unpair-device", deviceId });
  }
}
