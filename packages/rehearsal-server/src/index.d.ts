// index.d.ts — what a host's type-checker sees of this package, instead of its sources.
// The sources run with noImplicitAny off (store.ts is untyped); a host's strict tsc must not read them.
// mount.ts is typed against this file, so the two cannot drift.

import type { Server } from "node:http";
import type { RemoteConfig } from "@studio/mediatek/remote";
import type { Express, Request, RequestHandler, Router } from "express";

export interface RehearsalMount {
  /** The boot work once the server listens: the one-time PocketBase import, the phone-mic signaling, the cache sweeps. */
  serve(server: Server): void;
  /** Close the signaling and stop the sweeps; idempotent. */
  stop(): Promise<void>;
}

export interface RehearsalOptions {
  requireAuth: RequestHandler;
  /** The server this request's account is paired with, or null: where a local instance's releases and pages are. */
  server?: (req: Request) => SongbookServer | null;
  /** The media library a session's bytes live in: the host's own, over loopback, with a service token. */
  mediatek: RemoteConfig;
}

/** Mount every rehearsal route on `app`; call it after setupAuth and before the media library. */
export declare function mountRehearsal(
  app: Express,
  opts: RehearsalOptions,
): RehearsalMount;

/** The paired server a request's account reaches, and the device token to call it with. */
export interface SongbookServer {
  base: string;
  token: string;
}

/** The songs a device may see, read-only: the public ones, and the private ones of `res.locals.syncCaller.person`, which `gate` sets — ../docs/songbookCopy.md. */
export declare function songbookDeviceRouter(gate: RequestHandler): Router;

/** A paired machine's songbook against its server's, and the copy of one song down. */
export declare function songbookCopyRouter(opts: {
  /** Where `songbookDeviceRouter` is mounted on the server. */
  deviceRoute: string;
  /** The server this request's account is paired with, or null. */
  server(req: Request): SongbookServer | null;
  /** Bring the médiathèque file at `path` down from that server, when this machine lacks it. */
  fetchTrack(req: Request, path: string): Promise<void>;
}): Router;

/** The server's half of a shared moment, behind a device token: the person's moment ids, and the upsert of one — ../docs/momentShare.md. */
export declare function momentDeviceRouter(gate: RequestHandler): Router;

/** A paired machine's moments against its server's, and the sharing of one; its session stays here. */
export declare function momentShareRouter(opts: {
  /** Where `momentDeviceRouter` is mounted on the server. */
  deviceRoute: string;
  /** The server this request's account is paired with, or null. */
  server(req: Request): SongbookServer | null;
}): Router;

/** Where the server answers a paired device's releases and pages. */
export declare const DEVICE_PUBLICATIONS_ROUTE: "/api/sync/k7";

/** The server's releases and pages for a device that passed `gate`, as the person its token names — ../docs/publications.md. */
export declare function publicationsDeviceRouter(gate: RequestHandler): Router;
