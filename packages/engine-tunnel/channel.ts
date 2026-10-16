// channel.ts — one virtual connection to an engine, carried by a supervisor's tunnel. Shaped
// like the slice of a `ws` WebSocket the relay and the file service's link use — `send`,
// `close`, `readyState` and the four events — so they pipe it without knowing it is not one.

import { EventEmitter } from "node:events";

export const CONNECTING = 0;
export const OPEN = 1;
export const CLOSED = 3;

/** How the hub hands a channel its outbound half; the channel never sees the tunnel itself. */
export interface ChannelSink {
  sendText(ch: number, text: string): void;
  sendBinary(ch: number, bytes: Buffer): void;
  close(ch: number): void;
  /** This channel's bytes handed to the tunnel and not yet written to its socket. */
  buffered(ch: number): number;
}

export class TunnelChannel extends EventEmitter {
  readyState: number = CONNECTING;

  /** Its OWN unsent bytes, not the tunnel's: one stalled channel is told apart from the others. */
  get bufferedAmount(): number {
    return this.sink.buffered(this.ch);
  }

  constructor(
    readonly ch: number,
    private readonly sink: ChannelSink,
  ) {
    super();
  }

  /** Text unless told otherwise, as `ws` decides from the argument's type. */
  send(
    data: string | Buffer | ArrayBuffer | Buffer[],
    opts?: { binary?: boolean },
  ): void {
    if (this.readyState !== OPEN) return;
    if (typeof data === "string" && !opts?.binary) {
      this.sink.sendText(this.ch, data);
      return;
    }
    const bytes = Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.isBuffer(data)
        ? data
        : typeof data === "string"
          ? Buffer.from(data)
          : Buffer.from(data);
    if (opts?.binary === false)
      this.sink.sendText(this.ch, bytes.toString("utf8"));
    else this.sink.sendBinary(this.ch, bytes);
  }

  close(): void {
    if (this.readyState === CLOSED) return;
    this.sink.close(this.ch);
    this.ended();
  }

  terminate(): void {
    this.close();
  }

  /** Called by the hub: the agent reached the engine. */
  opened(): void {
    if (this.readyState !== CONNECTING) return;
    this.readyState = OPEN;
    this.emit("open");
  }

  /** Called by the hub for every engine frame; `isBinary` as `ws` reports it. */
  deliver(data: Buffer | string, isBinary: boolean): void {
    if (this.readyState !== OPEN) return;
    this.emit(
      "message",
      typeof data === "string" ? Buffer.from(data) : data,
      isBinary,
    );
  }

  /** Called by the hub when either end let go, or the tunnel itself dropped. */
  ended(): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.emit("close", 1001, Buffer.from("tunnel channel closed"));
  }
}
