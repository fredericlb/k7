// The Supernote password at rest.
//
// It is sealed, not hashed: the hourly sync signs in on its own, with nobody there to
// retype anything, so the plain text has to come back. AES-256-GCM under a key derived
// from the service secret — losing that secret costs a re-activation, nothing worse.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { env } from "../env.ts";

const KEY = scryptSync(env.supernoteSecret, "k7-supernote", 32);

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function unseal(sealed: string): string {
  const [iv, tag, body] = sealed
    .split(".")
    .map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !body)
    throw new Error("the stored password is unreadable");
  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString(
    "utf8",
  );
}
