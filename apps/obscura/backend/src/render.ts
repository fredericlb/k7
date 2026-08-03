// render.ts — obscura's link to a studio engine. The ONE exception in the whole per-account
// engine story: obscura renders offline and never plays, so the engine belongs to the
// BACKEND and not to a player. See docs/render.md.

import type { PublicEngine } from "@studio/web-protocol";

/** The engine this service renders on. One string, from the environment. */
const CONFIGURED = process.env.OBSCURA_RENDER_ENGINE ?? "";

const REQUEST_TIMEOUT_MS = 6 * 60_000;

export class NoRenderEngine extends Error {}

/**
 * Which machine renders for this service.
 *
 * CONFIGURED, not chosen and not per user — the difference that makes obscura the exception.
 * Nobody here is sitting at an interface: a render has no audience, so "which of my
 * machines" is a deployment fact, and asking a player would be asking them about someone
 * else's hardware.
 *
 * `OBSCURA_RENDER_ENGINE` is the file service's base URL on that machine
 * (`http://192.168.1.20:8770`), because that is the surface that can exec the binary — not
 * the engine's own WebSocket, which has no render verb and never will: an offline bounce is
 * a one-shot process, `studio-moteur --render`, and giving the live server a way to start
 * one would put a second engine inside the process holding the audio device.
 */
export function renderTarget(): string {
  if (!CONFIGURED)
    throw new NoRenderEngine(
      "OBSCURA_RENDER_ENGINE is not set — no machine can render for this service",
    );
  return CONFIGURED.replace(/\/$/, "");
}

/** Whether a render is even possible, for a health line that says so before anyone asks. */
export function canRender(): boolean {
  return CONFIGURED !== "";
}

/**
 * Bounce a compiled document to audio and return the wav bytes.
 *
 * The whole file in memory, deliberately: obscura's clips are seconds long, and the
 * alternative — a temp file this container then has to clean up on every failure path — is
 * more machinery than the bytes are worth. A full-length master would need a stream, and
 * this is the line to revisit if one ever does.
 */
export async function renderProject(
  doc: unknown,
  engineToken?: string,
): Promise<Buffer> {
  const res = await fetch(`${renderTarget()}/render`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // The file service's light LAN gate. Server-to-server there is no Origin header, so
      // CORS allows the call outright — the token is what makes it deliberate.
      ...(engineToken ? { "x-studio-engine-token": engineToken } : {}),
    },
    body: JSON.stringify({ doc }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    // The machine says WHY (no binary, bad document, timeout) and that sentence is the
    // whole value: from here every failure otherwise looks like "render failed".
    const why = await res.text().catch(() => "");
    throw new Error(`render ${res.status}: ${why.slice(0, 500)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Re-exported so a caller can type an engine listing without reaching into web-protocol. */
export type { PublicEngine };
