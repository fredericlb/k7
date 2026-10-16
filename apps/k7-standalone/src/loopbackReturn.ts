// loopbackReturn.ts — a one-shot listener on a free loopback port, where the system browser comes back to
// this app (RFC 8252 §8.12): the first request on `path` carrying `state` is answered, and the port closes.

import { createServer } from "node:http";

/** A return left unfinished in the browser stops listening after this. */
const WAIT_MS = 10 * 60_000;

/** What the browser tab shows: `said` is plain text, escaped here. */
export interface LoopbackAnswer {
  status: number;
  said: string;
}

const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );

const page = (
  said: string,
): string => `<!doctype html><meta charset="utf-8"><title>k7</title>
<body style="font:16px system-ui;background:#101114;color:#e4e4e7;display:grid;place-items:center;height:100vh;margin:0">
<p>${escapeHtml(said)}</p>`;

/** Why a return ended without its answer: the port would not open, the browser would not, or nobody came back. */
export type LoopbackFailure = "listen" | "unopened" | "timeout";

/** Listen, then `open(back)` with the address to return to; `onHit` answers null for a request that is not the one. */
export function loopbackReturn(opts: {
  path: string;
  state: string;
  onHit: (params: URLSearchParams) => LoopbackAnswer | null;
  /** False when the browser could not be opened. */
  open: (back: string) => boolean;
  /** Never called after `close()` nor after an answer. */
  onFail?: (why: LoopbackFailure, detail?: string) => void;
}): { close(): void } {
  let live = true;
  const end = (): boolean => {
    if (!live) return false;
    live = false;
    clearTimeout(timer);
    server.close();
    return true;
  };
  const fail = (why: LoopbackFailure, detail?: string) => {
    if (end()) opts.onFail?.(why, detail);
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const answer =
      live &&
      url.pathname === opts.path &&
      url.searchParams.get("state") === opts.state
        ? opts.onHit(url.searchParams)
        : null;
    if (!answer) {
      res.writeHead(404).end();
      return;
    }
    end();
    res
      .writeHead(answer.status, { "Content-Type": "text/html; charset=utf-8" })
      .end(page(answer.said));
  });
  server.on("error", (e) => fail("listen", e.message));
  // Any free port: the server allows any loopback return, and the state ties this answer to this request.
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return;
    if (!opts.open(`http://127.0.0.1:${address.port}${opts.path}`))
      fail("unopened");
  });
  const timer = setTimeout(() => fail("timeout"), WAIT_MS);
  timer.unref();
  return { close: () => void end() };
}
