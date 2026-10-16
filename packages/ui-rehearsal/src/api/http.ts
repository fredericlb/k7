// http.ts — every rehearsal call's fetch: the session cookie, the host's base, and an error that
// carries the server's own sentence and status.

import { apiBase } from "../config";
import { m } from "../paraglide/messages.js";

/** A publish token as its owner sees it: never the token itself. */
export interface ApiToken {
  id: string;
  label: string;
  created: number;
  expires: number;
  lastUsed: number | null;
}

// Every call sends the session cookie, under the base the host configured (config.ts).
export const f = (path: string, init?: RequestInit) =>
  fetch(`${apiBase()}${path}`, { credentials: "include", ...init });

/** A failed call: the server's own sentence when it sent one, and the status a caller tells 404 by. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const json = async (res: Response) => {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(
      body.error ?? m["common.requestFailed"]({ status: res.status }),
      res.status,
    );
  }
  return res.status === 204 ? null : res.json();
};

/** A page open to anyone signed in, asked for without a session: signing in may still open it. */
export class UnauthenticatedError extends Error {}
