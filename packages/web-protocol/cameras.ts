// cameras.ts — remote cameras: a device in camera mode offers its lens to the SAME account on the
// same server, and a project's camera node names it as `remote:<device name>`. Both halves are here
// because the backend's hub and the browser must agree on the paths, the frames and which camera a
// label names. A name is a label a person reads, never an id. See packages/web-protocol/docs/cameras.md.

/** The account's cameras: `GET` lists them, `POST <path>/ticket` mints what opens the socket. */
export const CAMERAS_ROUTE = "/api/cameras";

/** The signalling socket, `?ticket=…&role=camera&name=…` or `?ticket=…&role=viewer`. */
export const CAMERAS_WS_PATH = "/api/cameras/ws";

/** What a camera node's label starts with when it names a remote camera rather than a local lens. */
export const REMOTE_CAMERA_PREFIX = "remote:";

/** The longest device name kept, so a label stays readable on a node's card. */
export const CAMERA_NAME_MAX = 60;

/** One camera of the account, as `GET /api/cameras` lists it. */
export interface RemoteCamera {
  name: string;
  /** Epoch ms it came on. */
  since: number;
}

/** The ticket route's answer: the socket's key, and the ICE servers this server was told to hand out. */
export interface CameraTicket {
  ticket: string;
  iceServers: RTCIceServerLike[];
}

/** `RTCIceServer`, declared structurally so the backend needs no DOM types. */
export interface RTCIceServerLike {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** The hub to a camera, once: the name it is listed under, made unique within the account. */
export interface CameraHello {
  type: "hello";
  name: string;
}
/** A viewer asking for a camera by label; the hub adds `from` on the way to the camera. */
export interface CameraWant {
  type: "want";
  label: string;
  from?: string;
}
export interface CameraOffer {
  type: "offer";
  sdp: { type: string; sdp?: string };
  to?: string;
  /** Why the camera a viewer gets is not the one it named — set by the hub, read by the viewer. */
  problem?: string | null;
}
export interface CameraAnswer {
  type: "answer";
  sdp: { type: string; sdp?: string };
  from?: string;
}
export interface CameraIce {
  type: "ice";
  candidate: {
    candidate?: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
  };
  to?: string;
  from?: string;
}
export interface CameraProblem {
  type: "problem";
  text: string;
  to?: string;
}
/** A viewer left: the camera drops its peer connection. */
export interface CameraGone {
  type: "gone";
  from: string;
}
/** How many viewers a camera is serving, sent to it whenever that changes. */
export interface CameraViewers {
  type: "viewers";
  count: number;
}

export type CameraFrame =
  | CameraHello
  | CameraWant
  | CameraOffer
  | CameraAnswer
  | CameraIce
  | CameraProblem
  | CameraGone
  | CameraViewers;

/** Read a frame, or null for anything that is not one. */
export function readCameraFrame(data: unknown): CameraFrame | null {
  try {
    const f = JSON.parse(String(data)) as CameraFrame;
    return f && typeof f === "object" && typeof f.type === "string" ? f : null;
  } catch {
    return null;
  }
}

/** Does this camera label name a remote camera? */
export const isRemoteLabel = (label: string): boolean =>
  label.startsWith(REMOTE_CAMERA_PREFIX);

/** The device name a remote label carries; `""` asks for whichever camera is on. */
export const remoteName = (label: string): string =>
  label.slice(REMOTE_CAMERA_PREFIX.length).trim();

/** The label a camera node writes for a device. */
export const remoteLabel = (name: string): string =>
  `${REMOTE_CAMERA_PREFIX}${name}`;

/** A device name as the hub keeps it: one line, trimmed, capped; empty falls back to `fallback`. */
export function cleanCameraName(raw: string, fallback = "camera"): string {
  // Control characters become spaces, then every run of spaces one.
  const one = [...raw]
    .map((c) => (c.charCodeAt(0) < 32 || c === "\u007f" ? " " : c))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return (one || fallback).slice(0, CAMERA_NAME_MAX);
}

/** The name a new camera gets among those already on: its own, else suffixed ` (2)`, ` (3)`… */
export function uniqueCameraName(
  want: string,
  taken: readonly string[],
): string {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  if (!used.has(want.toLowerCase())) return want;
  for (let n = 2; ; n++) {
    const next = `${want} (${n})`;
    if (!used.has(next.toLowerCase())) return next;
  }
}

/** Which camera a remote label names: exact, then ignoring case, then containment — and the newest when it names none. */
export function matchRemoteCamera(
  label: string,
  cameras: readonly RemoteCamera[],
): { name: string | null; problem?: string } {
  if (!cameras.length) return { name: null, problem: "no remote camera is on" };
  const want = remoteName(label);
  const newest = [...cameras].sort(
    (a, b) => b.since - a.since,
  )[0] as RemoteCamera;
  if (!want) return { name: newest.name };
  const low = want.toLowerCase();
  const hit =
    cameras.find((c) => c.name === want) ??
    cameras.find((c) => c.name.toLowerCase() === low) ??
    cameras.find((c) => c.name.toLowerCase().includes(low)) ??
    cameras.find((c) => low.includes(c.name.toLowerCase()));
  if (hit) return { name: hit.name };
  // Nothing refused, as for a local lens: a picture with its explanation beats a black lane.
  return {
    name: newest.name,
    problem: `no remote camera called "${want}" is on — showing "${newest.name}" (on: ${cameras.map((c) => c.name).join(", ")})`,
  };
}
