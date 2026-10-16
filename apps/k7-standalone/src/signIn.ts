// signIn.ts — sign in through the SYSTEM browser and carry the session back into the app (RFC 8252 §8.12).
// The browser gets a one-use code on a loopback port; the code is useless without the verifier this process keeps. See docs/signIn.md.

import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { openExternalSafely } from "@frediverse/electron-shell/external";
import { line } from "@frediverse/electron-shell/log";
import {
  handoffIssueUrl,
  handoffRedeemUrl,
} from "@studio/web-protocol/handoff";
import { onCancel, setAccountStatus } from "./accountStatus.ts";

/** A sign-in left unfinished in the browser stops listening after this. */
const WAIT_MS = 10 * 60_000;

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>k7</title>
<body style="font:16px system-ui;background:#101114;color:#e4e4e7;display:grid;place-items:center;height:100vh;margin:0">
<p>Signed in. You can close this tab and go back to k7.</p>`;

const b64 = (b: Buffer): string => b.toString("base64url");

let pending: Server | null = null;
let forget: () => void = () => undefined;

/** Stop listening for `server`'s answer; true when it was still the one waited for. */
function abandon(server: Server): boolean {
  if (pending !== server) return false;
  server.close();
  pending = null;
  forget();
  return true;
}

/** Open the browser on the sign-in; `onSignedIn` gets the address that turns the code into a session in a tab. */
export function signIn(
  origin: string,
  onSignedIn: (redeemUrl: string) => void,
): void {
  // A second click starts over: the first browser tab's code would land on a closed port.
  if (pending) abandon(pending);
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
    abandon(server);
    line("app", "signed in through the browser");
    setAccountStatus({ state: "done", code: "signedIn" });
    onSignedIn(handoffRedeemUrl(origin, { code, verifier }));
  });
  pending = server;
  // Cancel in the account bar closes the port: the browser's answer then lands nowhere.
  forget = onCancel(() => abandon(server));
  setAccountStatus({ state: "waiting", what: "signIn" });
  server.on("error", (e) => {
    line("app", `sign-in could not listen: ${e.message}`);
    if (abandon(server))
      setAccountStatus({ state: "error", code: "signInFailed" });
  });
  // Any free port: the server allows any loopback return, and the state ties this answer to this request.
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return;
    const redirect = `http://127.0.0.1:${address.port}/done`;
    const opened = openExternalSafely(
      handoffIssueUrl(origin, { redirect, challenge, state, forget: true }),
    );
    if (!opened && abandon(server))
      setAccountStatus({ state: "error", code: "signInFailed" });
  });
  setTimeout(() => {
    if (abandon(server))
      setAccountStatus({ state: "error", code: "signInTimeout" });
  }, WAIT_MS).unref();
}
