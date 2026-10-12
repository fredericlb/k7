// signIn.ts — sign in through the SYSTEM browser and carry the session back into the app (RFC 8252 §8.12).
// The browser gets a one-use code on a loopback port; the code is useless without the verifier this process keeps. See docs/signIn.md.

import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { line } from "@frediverse/electron-shell/log";
import {
  handoffIssueUrl,
  handoffRedeemUrl,
} from "@studio/web-protocol/handoff";
import { shell } from "electron";

/** A sign-in left unfinished in the browser stops listening after this. */
const WAIT_MS = 10 * 60_000;

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>st0</title>
<body style="font:16px system-ui;background:#101114;color:#e4e4e7;display:grid;place-items:center;height:100vh;margin:0">
<p>Signed in. You can close this tab and go back to st0.</p>`;

const b64 = (b: Buffer): string => b.toString("base64url");

let pending: Server | null = null;

/** Open the browser on the sign-in; `onSignedIn` gets the address that turns the code into a session in a tab. */
export function signIn(
  origin: string,
  onSignedIn: (redeemUrl: string) => void,
): void {
  // A second click starts over: the first browser tab's code would land on a closed port.
  pending?.close();
  const verifier = b64(randomBytes(32));
  const challenge = b64(createHash("sha256").update(verifier).digest());
  const state = b64(randomBytes(16));

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const code = url.searchParams.get("code");
    if (
      url.pathname !== "/done" ||
      !code ||
      url.searchParams.get("state") !== state
    ) {
      res.writeHead(404).end();
      return;
    }
    res
      .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      .end(DONE_PAGE);
    server.close();
    pending = null;
    line("app", "signed in through the browser");
    onSignedIn(handoffRedeemUrl(origin, { code, verifier }));
  });
  pending = server;
  // Any free port: the server allows any loopback return, and the state ties this answer to this request.
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return;
    const redirect = `http://127.0.0.1:${address.port}/done`;
    void shell.openExternal(
      handoffIssueUrl(origin, { redirect, challenge, state, forget: true }),
    );
  });
  setTimeout(() => {
    if (pending === server) {
      server.close();
      pending = null;
    }
  }, WAIT_MS).unref();
}
