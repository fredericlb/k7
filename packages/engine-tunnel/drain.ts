// drain.ts — wait until a socket's send buffer has room, so streaming a large file never
// queues it whole in memory. `ws` exposes no drain event on the WebSocket, so it is polled.

/** Past this many unsent bytes a sender waits; small, since every other channel's frames queue behind it — docs/tunnel.md. */
export const HIGH_WATER_BYTES = 1024 * 1024;

export async function drained(sock: {
  bufferedAmount: number;
  readyState: number;
}): Promise<void> {
  while (sock.bufferedAmount > HIGH_WATER_BYTES && sock.readyState === 1)
    await new Promise((r) => setTimeout(r, 5));
}
