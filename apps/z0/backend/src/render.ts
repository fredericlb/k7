// render.ts — z0's link to a studio engine. The ONE exception in the whole per-account
// engine story: z0 renders offline and never plays, so the engine belongs to the
// BACKEND and not to a player. See docs/render.md.

import type { PublicEngine } from "@studio/web-protocol";

/** The engine this service renders on. One string, from the environment. */
const CONFIGURED = process.env.Z0_RENDER_ENGINE ?? "";

const REQUEST_TIMEOUT_MS = 6 * 60_000;

export class NoRenderEngine extends Error {}

/** Which machine renders: CONFIGURED, never chosen, and a file service URL — ../../docs/origin.md. */
export function renderTarget(): string {
  if (!CONFIGURED)
    throw new NoRenderEngine(
      "Z0_RENDER_ENGINE is not set — no machine can render for this service",
    );
  return CONFIGURED.replace(/\/$/, "");
}

/** Whether a render is even possible, for a health line that says so before anyone asks. */
export function canRender(): boolean {
  return CONFIGURED !== "";
}

/** Bounce a document to wav bytes, whole and in memory — see ../../docs/origin.md. */
export async function renderProject(
  doc: unknown,
  engineToken?: string,
): Promise<Buffer> {
  const res = await fetch(`${renderTarget()}/render`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // The file service's LAN gate; server-to-server, this token is what makes the call deliberate.
      ...(engineToken ? { "x-studio-engine-token": engineToken } : {}),
    },
    body: JSON.stringify({ doc }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    // Carry the machine's own sentence: from here, every failure otherwise reads "render failed".
    const why = await res.text().catch(() => "");
    throw new Error(`render ${res.status}: ${why.slice(0, 500)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Re-exported so a caller can type an engine listing without reaching into web-protocol. */
export type { PublicEngine };
