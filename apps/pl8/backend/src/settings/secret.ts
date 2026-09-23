// secret.ts — the slskd API key and the SFTP credentials at rest. Sealed, not hashed: a hunt
// runs in the background with nobody there to retype them, so the plain text has to come back.
// AES-256-GCM under a key derived from the session secret — losing it costs retyping them.
// See ../../docs/settings.md.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

// Derived on first use: `env.yaml` is layered into process.env AFTER this module loads.
let derived: { from: string; key: Buffer } | null = null;

function key(): Buffer {
  const from = `${process.env.SESSION_SECRET ?? ""}:pl8-settings`;
  if (derived?.from !== from)
    derived = { from, key: scryptSync(from, "pl8-settings", 32) };
  return derived.key;
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
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
    throw new Error("un secret enregistré est illisible");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString(
    "utf8",
  );
}
