// testBadFrame.ts — the peer every upgrade path's suite plays: it completes a WebSocket handshake
// by hand, then sends a frame with RSV1 set, which `ws` refuses with an `error` (docs/upgrade.md).
// Tests only; a real client library would never let a test send such a frame.

import { connect } from "node:net";

/** Handshake on `path`, send one RSV1 frame, and resolve with the reply's status line once the server closed the socket. */
export function sendBadFrame(
  port: number,
  path: string,
  headers: Record<string, string> = {},
  timeoutMs = 3000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = connect(port, "127.0.0.1");
    let reply = "";
    let sent = false;
    const timer = setTimeout(() => {
      s.destroy();
      reject(
        new Error(`the server kept the socket open: ${reply.split("\r\n")[0]}`),
      );
    }, timeoutMs);
    s.on("connect", () => {
      const extra = Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}\r\n`)
        .join("");
      s.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n${extra}\r\n`,
      );
    });
    s.on("data", (d) => {
      reply += d.toString("latin1");
      if (sent || !reply.includes("\r\n\r\n")) return;
      sent = true;
      // FIN + RSV1 + text, masked, an empty payload: no extension was negotiated, so RSV1 is a protocol fault.
      s.write(Buffer.from([0xc1, 0x80, 1, 2, 3, 4]));
    });
    s.on("error", () => {});
    s.on("close", () => {
      clearTimeout(timer);
      resolve(reply.split("\r\n")[0]);
    });
  });
}
