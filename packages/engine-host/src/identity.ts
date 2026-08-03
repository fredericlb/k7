// identity.ts — the engine's stable local identity (~/.studio/engine-id.json): a
// persistent id + a secret token, passed to the C++ engine and echoed on `whoami`, so a
// lookalike listener can't produce the real token and the registry can reject it. A
// per-engine secret, not a user credential — there are no accounts yet.

import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { engineIdPath } from "@studio/engine-client/paths";

export const ENGINE_ID_PATH = engineIdPath();

export interface EngineIdentity {
  id: string;
  token: string;
  createdAt: string; // ISO 8601
}

function isIdentity(v: unknown): v is EngineIdentity {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as EngineIdentity).id === "string" &&
    typeof (v as EngineIdentity).token === "string"
  );
}

// Read the persisted identity or mint one, so a machine keeps its id and the registry knows it after a restart.
export function ensureEngineIdentity(): EngineIdentity {
  try {
    const v = JSON.parse(readFileSync(ENGINE_ID_PATH, "utf8"));
    if (isIdentity(v)) return v;
  } catch {
    /* missing or malformed — mint a new one below */
  }
  const identity: EngineIdentity = {
    id: randomUUID(),
    token: randomBytes(24).toString("hex"),
    createdAt: new Date().toISOString(),
  };
  if (!existsSync(dirname(ENGINE_ID_PATH)))
    mkdirSync(dirname(ENGINE_ID_PATH), { recursive: true });
  writeFileSync(
    ENGINE_ID_PATH,
    `${JSON.stringify(identity, null, 2)}\n`,
    "utf8",
  );
  return identity;
}
