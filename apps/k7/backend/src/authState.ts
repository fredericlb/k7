// authState.ts — where k7 keeps the state that makes a session or a token revocable: a dot-folder of
// the media volume, so it survives a redeploy and no library scan ever lists it (../docs/sessions.md).

import { join } from "node:path";
import {
  createSessionRevocations,
  type SessionRevocations,
} from "@frediverse/oidc";
import { mediatekDir } from "@studio/mediatek/layout";

/** `$STUDIO_AUTH_DIR`, or `.auth` on the media volume. */
export function authDir(): string {
  return process.env.STUDIO_AUTH_DIR || join(mediatekDir(), ".auth");
}

/** The per-account "not before" epochs a logout everywhere writes. */
export function sessionRevocations(): SessionRevocations {
  return createSessionRevocations({
    file: join(authDir(), "session-revocations.json"),
  });
}
