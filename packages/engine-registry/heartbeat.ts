// heartbeat.ts — reading an engine's heartbeat without letting one odd field unlist it. Only what
// the registry cannot do without is REQUIRED: the id, the token and the port the engine answers on.
// Everything else is cleaned — an address that is not IPv4 dropped, a rating out of bounds left out
// — and each cleaning is SAID, since it is still news to whoever runs that machine.
//
// It used to be one strict schema, and a Windows machine whose performance block (or one address)
// failed it had EVERY heartbeat refused with a 400: listed once, lapsed fifteen seconds later, and
// "unknown engine or bad token" on the play that followed. See docs/heartbeat.md.

import type { EngineAddresses } from "@studio/web-protocol";
import type { EnginePerformance } from "@studio/web-protocol/performance";
import { z } from "zod";

// Addresses are ADDRESSES: `/registry/heartbeat` is open by design, and an unvalidated string would let anyone aim this server at a name.
const ipv4 = z.ipv4();

// Bounded, because the heartbeat is open: a rating is a hint for a picker, never a number to trust blindly.
const performanceSchema = z.object({
  score: z.number().int().min(0).max(1_000_000),
  cores: z.number().int().min(1).max(4096),
  singleThread: z.number().min(0).max(1_000_000),
  diskWriteMBps: z.number().min(0).max(1_000_000).nullable(),
  fsyncPerSec: z.number().min(0).max(10_000_000).nullable(),
  memoryGB: z.number().min(0).max(1_000_000),
});

/** An engine id as a path segment and a log line can carry it: short, and nothing to escape. */
const ENGINE_ID = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/, "an id is letters, digits, '.', '_' or '-'");

/** The part without which there is no entry at all: who it is, and where it answers. */
const coreSchema = z.object({
  id: ENGINE_ID,
  token: z.string().min(1).max(256),
  // Optional for a supervisor older than it, never CLEANED: a malformed secret is refused, not demoted to none.
  tunnelSecret: z.string().min(32).max(256).optional(),
  addresses: z.object({ port: z.number().int().min(1).max(65535) }),
});

/** A heartbeat the registry can keep, with what had to be cleaned out of it to get there. */
export interface ReadHeartbeat {
  id: string;
  token: string;
  /** The supervisor's tunnel secret, absent from one older than it. */
  tunnelSecret?: string;
  hostname: string;
  machineFingerprint: string;
  addresses: EngineAddresses;
  performance?: EnginePerformance;
  /** The library level the machine runs; absent from a supervisor older than the field, which runs level 1. */
  libraryLevel?: number;
  /** The engine wire's version it speaks; absent from a supervisor older than the field, which speaks 1. */
  protocol?: number;
  /** The release stamp it was built from, `dev` for a local build. */
  build?: string;
  /** It runs without external plugins after crashing again and again — engine/k7-supervisor/docs/crashLoop.md. */
  safeMode?: boolean;
  /** One line per field that was dropped or replaced — empty for a heartbeat taken as sent. */
  cleaned: string[];
}

/** `path: message`, the way a person reads a zod refusal. */
const issuesOf = (e: z.ZodError): string =>
  e.issues
    .map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`)
    .join("; ");

/** Read one heartbeat, or say which of the REQUIRED fields made it unreadable. */
export function readHeartbeat(
  body: unknown,
): { ok: true; beat: ReadHeartbeat } | { ok: false; error: string } {
  const core = coreSchema.safeParse(body);
  if (!core.success) return { ok: false, error: issuesOf(core.error) };
  const b = body as Record<string, unknown>;
  const a = (b.addresses ?? {}) as Record<string, unknown>;
  const cleaned: string[] = [];

  const text = (key: "hostname" | "machineFingerprint"): string => {
    const v = b[key];
    if (typeof v === "string") return v.slice(0, 255);
    if (v !== undefined) cleaned.push(`${key}: not a string, left empty`);
    return "";
  };

  let loopback = "127.0.0.1";
  if (ipv4.safeParse(a.loopback).success) loopback = a.loopback as string;
  else if (a.loopback !== undefined)
    cleaned.push(
      `addresses.loopback: ${JSON.stringify(a.loopback)} is not IPv4, 127.0.0.1 used`,
    );

  const lanIps: string[] = [];
  if (Array.isArray(a.lanIps))
    for (const ip of a.lanIps)
      if (ipv4.safeParse(ip).success) lanIps.push(ip as string);
      else
        cleaned.push(
          `addresses.lanIps: ${JSON.stringify(ip)} is not IPv4, left out`,
        );
  else if (a.lanIps !== undefined)
    cleaned.push("addresses.lanIps: not a list, no LAN address kept");

  let performance: EnginePerformance | undefined;
  if (b.performance !== undefined && b.performance !== null) {
    const p = performanceSchema.safeParse(b.performance);
    if (p.success) performance = p.data;
    else cleaned.push(`performance left out — ${issuesOf(p.error)}`);
  }

  let libraryLevel: number | undefined;
  if (Number.isInteger(b.libraryLevel) && (b.libraryLevel as number) >= 1)
    libraryLevel = b.libraryLevel as number;
  else if (b.libraryLevel !== undefined)
    cleaned.push(
      `libraryLevel: ${JSON.stringify(b.libraryLevel)} is no level, left out`,
    );

  let protocol: number | undefined;
  if (Number.isInteger(b.protocol) && (b.protocol as number) >= 1)
    protocol = b.protocol as number;
  else if (b.protocol !== undefined)
    cleaned.push(
      `protocol: ${JSON.stringify(b.protocol)} is no version, read as 1`,
    );

  let build: string | undefined;
  if (typeof b.build === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(b.build))
    build = b.build;
  else if (b.build !== undefined)
    cleaned.push(`build: ${JSON.stringify(b.build)} is no stamp, left out`);
  if (b.safeMode !== undefined && typeof b.safeMode !== "boolean")
    cleaned.push(
      `safeMode: ${JSON.stringify(b.safeMode)} is no flag, read as false`,
    );

  return {
    ok: true,
    beat: {
      id: core.data.id,
      token: core.data.token,
      ...(core.data.tunnelSecret
        ? { tunnelSecret: core.data.tunnelSecret }
        : {}),
      hostname: text("hostname"),
      machineFingerprint: text("machineFingerprint"),
      addresses: { loopback, lanIps, port: core.data.addresses.port },
      ...(performance ? { performance } : {}),
      ...(libraryLevel ? { libraryLevel } : {}),
      ...(protocol ? { protocol } : {}),
      ...(build ? { build } : {}),
      ...(b.safeMode === true ? { safeMode: true } : {}),
      cleaned,
    },
  };
}

/** How often the same complaint about the same engine is logged again — a heartbeat comes every 5 s. */
const COMPLAINT_EVERY_MS = 60_000;

/** A logger that says each (engine, complaint) once a minute at most, rather than every heartbeat. */
export function throttledLog(
  log: (line: string) => void,
  every = COMPLAINT_EVERY_MS,
  now: () => number = Date.now,
): (key: string, line: string) => void {
  const last = new Map<string, number>();
  return (key, line) => {
    const t = now();
    const seen = last.get(key);
    if (seen !== undefined && t - seen < every) return;
    last.set(key, t);
    // Bounded: an open route must not grow a map forever out of ids anyone can invent.
    if (last.size > 1000) last.delete(last.keys().next().value as string);
    log(line);
  };
}
