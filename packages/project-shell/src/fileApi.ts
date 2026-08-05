// fileApi.ts — the transport to the engine-side file service: where it is, the three headers
// that identify the caller, and the two verbs everything else is built from. Cross-origin and
// header-authenticated, never same-origin — see apps/l8/AGENTS.md for the three servers a
// project app talks to and which is which.

import {
  ENGINE_TOKEN_HEADER,
  USER_HEADER,
  WORKSPACE_HEADER,
} from "@studio/web-protocol";

export interface FileCfg {
  base: string; // http://<engine-host>:<filePort>
  userEmail: string; // trusted (Phase-2 local trust)
  workspace: string; // the folder on that machine holding the repository
  engineToken: string; // the light LAN gate (from the whoami probe)
}

let fileCfg: FileCfg | null = null;

/** Point every file op at a chosen engine + workspace. Called by the gate, once. */
export function configureFileApi(config: FileCfg): void {
  fileCfg = config;
}

export function cfg(): FileCfg {
  if (!fileCfg)
    throw new Error("file API not configured (no project opened yet)");
  return fileCfg;
}

export function fileHeaders(extra?: HeadersInit): HeadersInit {
  const c = cfg();
  return {
    ...extra,
    [USER_HEADER]: c.userEmail,
    [WORKSPACE_HEADER]: c.workspace,
    [ENGINE_TOKEN_HEADER]: c.engineToken,
  };
}

export async function fget<T>(path: string): Promise<T> {
  const res = await fetch(cfg().base + path, { headers: fileHeaders() });
  if (!res.ok) {
    const e: Error & { status?: number } = new Error(
      (await res.json().catch(() => ({}))).error ?? `GET ${path} failed`,
    );
    // Carried for the callers that have to tell "nothing there" from "it went wrong".
    e.status = res.status;
    throw e;
  }
  return res.json() as Promise<T>;
}

export async function fsend<T>(
  method: string,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(cfg().base + path, {
    method,
    headers: fileHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e: Error & { status?: number } = new Error(
      (await res.json().catch(() => ({}))).error ?? `${method} ${path} failed`,
    );
    e.status = res.status;
    throw e;
  }
  return res.json() as Promise<T>;
}

/** Absolute URL for a <video>/<audio> element. Everything rides in the query — including the
 *  engine token — because an element GET cannot send headers. */
export function mediaUrl(path: string): string {
  const c = cfg();
  const q = new URLSearchParams({
    user: c.userEmail,
    workspace: c.workspace,
    path,
    token: c.engineToken,
  });
  return `${c.base}/media?${q.toString()}`;
}

/**
 * Why a file-service call failed, when fetch() won't say.
 *
 * A refused CORS preflight and a dead server are the SAME rejection in JS — an opaque
 * `TypeError: NetworkError`, with no status and no body, because letting a page read that
 * difference is precisely what CORS exists to prevent. But the difference is the whole of the
 * user's next action: "click allow in the tray" versus "start the engine".
 *
 * `mode: "no-cors"` is the way through: it sends a simple GET with no preflight and no ACAO
 * check, yielding an opaque response we cannot read but whose ARRIVAL proves something
 * answered. So:
 *   probe resolves -> the service is up and refused our origin  -> "blocked"
 *   probe rejects  -> nothing is listening at that address      -> "unreachable"
 */
export type FileServiceFault = "blocked" | "unreachable";

export async function diagnoseFileService(
  base?: string | null,
): Promise<FileServiceFault> {
  const target = base ?? fileCfg?.base;
  if (!target) return "unreachable";
  try {
    await fetch(`${target}/health`, { mode: "no-cors", cache: "no-store" });
    return "blocked";
  } catch {
    return "unreachable";
  }
}
