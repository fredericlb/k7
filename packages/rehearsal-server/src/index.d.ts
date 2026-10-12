// index.d.ts — what a host's type-checker sees of this package, instead of its sources.
// The sources run with noImplicitAny off (store.ts is untyped); a host's strict tsc must not read them.
// mount.ts is typed against this file, so the two cannot drift.

import type { Server } from "node:http";
import type { RemoteConfig } from "@studio/mediatek/remote";
import type { Express, RequestHandler } from "express";

export interface RehearsalMount {
  /** The boot work once the server listens: the PocketBase schema, the phone-mic signaling, the cache sweeps. */
  serve(server: Server): void;
  /** Close the signaling and stop the sweeps; idempotent. */
  stop(): Promise<void>;
}

export interface RehearsalOptions {
  requireAuth: RequestHandler;
  /** The media library a session's bytes live in: the host's own, over loopback, with a service token. */
  mediatek: RemoteConfig;
}

/** Mount every rehearsal route on `app`; call it after setupAuth and before the media library. */
export declare function mountRehearsal(
  app: Express,
  opts: RehearsalOptions,
): RehearsalMount;
