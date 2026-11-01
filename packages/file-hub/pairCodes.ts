// pairCodes.ts — a server's one-use codes for a machine's sign-in: issued after the person signed in afresh, sent back
// to the machine's return in place of a token, and traded for one with the verifier only the machine holds (PKCE S256).
// A code stolen off the redirect is worth nothing without that verifier. Kept in memory: one lives two minutes.
// See docs/syncRelay.md, "Signing in is pairing".

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** How long a code waits for the machine's backend to trade it. */
export const PAIR_CODE_MS = 2 * 60_000;

/** What a code stands for: the person who signed in, and the device it names. */
export interface PairGrant {
  user: string;
  sub: string;
  name: string;
}

/** S256 of a verifier, as RFC 7636 spells it: base64url of its SHA-256, no padding. */
export const challengeOf = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");

/** A fresh verifier: 32 random bytes, base64url, within RFC 7636's 43 to 128 characters. */
export const newVerifier = (): string => randomBytes(32).toString("base64url");

/** A challenge as a client may send one: base64url, the length S256 gives. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export class PairCodes {
  private readonly codes = new Map<
    string,
    PairGrant & { challenge: string; until: number }
  >();

  constructor(private readonly now: () => number = Date.now) {}

  /** A code for `grant`, bound to `challenge`; null for a challenge that is not one. */
  issue(grant: PairGrant, challenge: string): string | null {
    if (!CHALLENGE.test(challenge)) return null;
    this.sweep();
    const code = randomBytes(24).toString("base64url");
    this.codes.set(code, {
      ...grant,
      challenge,
      until: this.now() + PAIR_CODE_MS,
    });
    return code;
  }

  /** The grant behind `code` when `verifier` matches its challenge; used up either way, so a guess gets one try. */
  redeem(code: string, verifier: string): PairGrant | null {
    const entry = this.codes.get(code);
    if (!entry) return null;
    this.codes.delete(code);
    if (entry.until < this.now()) return null;
    const want = Buffer.from(entry.challenge);
    const got = Buffer.from(challengeOf(verifier));
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    return { user: entry.user, sub: entry.sub, name: entry.name };
  }

  private sweep(): void {
    const now = this.now();
    for (const [code, e] of this.codes)
      if (e.until < now) this.codes.delete(code);
  }
}
