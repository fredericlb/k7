// signIn.ts — sign in through the SYSTEM browser and carry the session back into the app (RFC 8252 §8.12).
// The browser gets a one-use code on a loopback port; the code is useless without the verifier this process keeps. See docs/signIn.md.

import { createHash, randomBytes } from "node:crypto";
import { openExternalSafely } from "@frediverse/electron-shell/external";
import { line } from "@frediverse/electron-shell/log";
import {
  handoffIssueUrl,
  handoffRedeemUrl,
} from "@studio/web-protocol/handoff";
import { loopbackReturn } from "./loopbackReturn.ts";

const b64 = (b: Buffer): string => b.toString("base64url");

let pending: { close(): void } | null = null;

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

  pending = loopbackReturn({
    path: "/done",
    state,
    onHit: (params) => {
      const code = params.get("code");
      if (!code) return null;
      line("app", "signed in through the browser");
      onSignedIn(handoffRedeemUrl(origin, { code, verifier }));
      return {
        status: 200,
        said: "Signed in. You can close this tab and go back to k7.",
      };
    },
    open: (redirect) =>
      openExternalSafely(
        handoffIssueUrl(origin, { redirect, challenge, state, forget: true }),
      ),
  });
}
