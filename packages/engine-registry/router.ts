// router.ts — the engine registry API, mounted under /api. Two audiences: ENGINES POST
// heartbeat/deregister to announce themselves (no lease — an engine is not a browser tab),
// and the BROWSER GETs /engines and POSTs /engine/select, token-checked. Mounting is the
// host's job: the engine routes must stay open while the browser ones need a session.

import { timingSafeEqual } from "node:crypto";
import { validate, wrap } from "@frediverse/http/route";
import type { TunnelHub } from "@studio/engine-tunnel/hub";
import type { PublicEngine } from "@studio/web-protocol";
import { REGISTRY_SERVICE } from "@studio/web-protocol/services";
import { type Request, Router } from "express";
import { z } from "zod";
import { readHeartbeat, throttledLog } from "./heartbeat.ts";
import { claimHolder, type EngineRole, mayUse, roleOf } from "./owners.ts";
import { ownershipRouter } from "./ownershipRoutes.ts";
import { issueEngineTicket } from "./proxy.ts";
import type { EngineRegistry } from "./registry.ts";

const deregisterBody = z.object({
  id: z.string().min(1),
  token: z.string().min(1),
  // A bound id's own secret: without it, the token every relay user can read would unlist the engine.
  tunnelSecret: z.string().max(256).optional(),
});

// Select CLAIMS the engine for a project after verifying the token; the backend never connects to an engine — see docs/claim.md.
const selectBody = z.object({
  id: z.string().min(1),
  token: z.string().min(1),
  // The launch address, `<repo>/<projet>`; absent or null for a surface that opens on no project and must not compete for one.
  project: z.string().nullish(),
  // Absent on the first call, which is an OPEN and always wins; present on every renewal.
  secret: z.string().optional(),
  // Informational: what the browser MEASURED for this link in ms, kept on the wire for the constraints this will grow.
  latencyMs: z.number().optional(),
});

// An SDP offer is a few kilobytes; the bound keeps an open route from buffering anything larger.
const rtcBody = z.object({
  sdp: z
    .string()
    .min(1)
    .max(64 * 1024),
});

// The claim's own secret, not the engine token: a goodbye may only drop the claim it actually holds — see docs/claim.md.
const releaseBody = z.object({
  id: z.string().min(1),
  secret: z.string().min(1),
});

/** Each way a heartbeat is refused, as its status and the sentence both logs carry. */
const REFUSALS = {
  secret: [
    403,
    "this id is bound to another machine's tunnel secret — a copied engine-id.json, or somebody else's id",
  ],
  token: [
    409,
    "id/token mismatch — this id is registered with another token; it is freed 15 s after that one's last heartbeat",
  ],
  full: [503, "the registry lists as many engines as it takes"],
  rate: [429, "too many new engines from this address in the last minute"],
} as const;

/** Who may list an engine here: a device paired with an account, or the render machine — docs/heartbeat.md. */
export interface HeartbeatGate {
  /** On, a heartbeat proving neither is refused; off, it is taken as before and only counted. */
  requireDevice: boolean;
  /** The account a device token belongs to, or null. */
  deviceOf: (token: string) => string | null;
  /** The deployment's render key, which the server's own engine presents; unset, none. */
  renderKey?: string;
}

const RENDER_KEY_HEADER = "x-studio-render-key";

/** The account (or `render`) a heartbeat's credentials prove, or null. */
function provenBy(
  req: { get(name: string): string | undefined },
  gate: HeartbeatGate,
): string | null {
  const bearer = /^Bearer (.+)$/.exec(req.get("authorization") ?? "")?.[1];
  const account = bearer ? gate.deviceOf(bearer) : null;
  if (account) return account;
  const key = req.get(RENDER_KEY_HEADER);
  if (gate.renderKey && key && safeEqual(key, gate.renderKey)) return "render";
  return null;
}

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** What the host tells the routes about an account beyond its name. */
export interface RouterOptions {
  /** Whether the request's account administers this origin: it may reset an engine's owner. */
  isAdmin?: (req: Request) => boolean;
  /** Who may list an engine; absent, anyone, as before — docs/heartbeat.md. */
  heartbeat?: HeartbeatGate;
}

/** The routes over the one registry, pl8's — see docs/shared.md. */
export function engineRegistryRouter(
  reg: EngineRegistry,
  tunnels?: TunnelHub,
  // Where a refused heartbeat or select is said — the server's own log; injected for the tests.
  log: (line: string) => void = (l) => console.warn(`[registry] ${l}`),
  opts: RouterOptions = {},
): Router {
  const router = Router();
  const gate = opts.heartbeat;
  /** What the request's account is to engine `id` — docs/ownership.md. */
  const roleFor = (id: string, holder: string): EngineRole =>
    roleOf(reg.owners.get(id), holder, !!tunnels?.isRenderer(id));
  // Once a minute per (engine, complaint): a machine refused every 5 s is one line, not twelve.
  const complain = throttledLog(log);
  /** Who a refusal is about, as the log should name it. */
  const who = (id: string, hostname?: string, ip?: string) =>
    `engine ${id}${hostname ? ` (${hostname})` : ""}${ip ? ` from ${ip}` : ""}`;

  // Open like the heartbeat, and says nothing but WHAT this is: the supervisor asks before it sends a token here.
  router.get("/registry/hello", (_req, res) => {
    res.json({ service: REGISTRY_SERVICE });
  });

  // Only the id, the token and the port can refuse one; any other odd field is CLEANED and said (heartbeat.ts).
  router.post(
    "/registry/heartbeat",
    wrap((req, res) => {
      const read = readHeartbeat(req.body);
      const body = (req.body ?? {}) as { id?: unknown; hostname?: unknown };
      const id = typeof body.id === "string" ? body.id : "?";
      const host = typeof body.hostname === "string" ? body.hostname : "";
      if (!read.ok) {
        complain(
          `${id}|refused`,
          `refused a heartbeat from ${who(id, host, req.ip)}: ${read.error}`,
        );
        // The reason in the body, so the supervisor's log carries it too.
        return res
          .status(400)
          .json({ error: `heartbeat refused — ${read.error}` });
      }
      const b = read.beat;
      // An open route would let anyone list a machine every account then sends its project to (docs/heartbeat.md).
      if (gate && !provenBy(req, gate)) {
        complain(
          `${b.id}|unpaired`,
          `${gate.requireDevice ? "refused" : "took"} a heartbeat from ${who(b.id, b.hostname, req.ip)} with no device token`,
        );
        if (gate.requireDevice)
          return res.status(401).json({
            error:
              "this studio lists paired machines only — pair this machine, or set STUDIO_DEVICE_TOKEN to a device token of your account",
          });
      }
      if (b.cleaned.length)
        complain(
          `${b.id}|cleaned|${b.cleaned.join("|")}`,
          `took a heartbeat from ${who(b.id, b.hostname, req.ip)} with fields cleaned: ${b.cleaned.join("; ")}`,
        );
      const up = reg.upsert({
        id: b.id,
        token: b.token,
        tunnelSecret: b.tunnelSecret,
        hostname: b.hostname,
        machineFingerprint: b.machineFingerprint,
        addresses: b.addresses,
        performance: b.performance,
        libraryLevel: b.libraryLevel,
        protocol: b.protocol,
        build: b.build,
        safeMode: b.safeMode,
        publicIpHint: req.ip,
      });
      if (!up.ok) {
        const [status, error] = REFUSALS[up.why];
        complain(
          `${b.id}|${up.why}`,
          `refused a heartbeat from ${who(b.id, b.hostname, req.ip)}: ${error}`,
        );
        return res.status(status).json({ error });
      }
      res.json({
        ok: true,
        ...(b.cleaned.length ? { cleaned: b.cleaned } : {}),
      });
    }),
  );

  router.post(
    "/registry/deregister",
    validate(deregisterBody),
    wrap((req, res) => {
      const { id, token, tunnelSecret } = req.body as z.infer<
        typeof deregisterBody
      >;
      if (!reg.remove(id, token, tunnelSecret))
        return res.status(403).json({ error: "id/token mismatch" });
      res.json({ ok: true });
    }),
  );

  // The pick list, token stripped, filtered by ownership, each usable entry with a RELAY TICKET for this account — docs/ownership.md.
  router.get(
    "/engines",
    wrap((req, res) => {
      const viewer = claimHolder(req);
      res.json(
        reg.list(req.ip, viewer).flatMap((e): PublicEngine[] => {
          const access = roleFor(e.id, viewer);
          if (access === "none") return [];
          // Unowned: probed from this browser alone, and its LAN addresses only to its own network.
          if (access === "unowned")
            return [
              {
                ...e,
                addresses: {
                  ...e.addresses,
                  lanIps: e.sameSourceIp ? e.addresses.lanIps : [],
                },
                access,
              },
            ];
          return [
            {
              ...e,
              access,
              ...(access === "shared"
                ? { ownedBy: reg.owners.get(e.id)?.owner }
                : {}),
              proxyTicket: issueEngineTicket(e.id, viewer),
              // A tunnel is what carries a WebRTC offer, so it is what makes one worth trying.
              rtc: tunnels?.has(e.id) || undefined,
              // Proved by the render key, so a browser may take it unasked — packages/engine-browser/docs/access.md.
              server: access === "server" || undefined,
            },
          ];
        }),
      );
    }),
  );

  router.use(ownershipRouter(reg, opts.isAdmin ?? (() => false)));

  // A browser's WebRTC offer, answered by the engine's supervisor through its tunnel — packages/engine-tunnel/docs/rtc.md.
  router.post(
    "/engine/:id/rtc",
    validate(rtcBody),
    wrap(async (req, res) => {
      const { sdp } = req.body as z.infer<typeof rtcBody>;
      if (!tunnels) return res.status(404).json({ error: "no tunnels here" });
      const id = String(req.params.id);
      // A data channel reaches the engine as its own machine would, so only a claim holder gets one — docs/proxy.md.
      if (!reg.holds(id, claimHolder(req)))
        return res
          .status(403)
          .json({ error: "claim this engine before opening a direct link" });
      try {
        res.json({ sdp: await tunnels.signal(id, sdp) });
      } catch (e) {
        // 503 and not 500: the engine is simply not reachable this way, and the relay still is.
        res.status(503).json({ error: (e as Error).message });
      }
    }),
  );

  router.post(
    "/engine/select",
    validate(selectBody),
    wrap((req, res) => {
      const { id, token, project, secret } = req.body as z.infer<
        typeof selectBody
      >;
      // The two refusals told APART: a lapsed heartbeat is the engine's machine to look at, a wrong token this page's.
      if (!reg.get(id)) {
        complain(
          `${id}|select-gone`,
          `select of ${who(id)} refused: no heartbeat from it in the last 15 s`,
        );
        return res.status(404).json({
          error:
            "engine gone — its machine has not sent a heartbeat in the last 15 s; its .studio.log says why",
        });
      }
      if (!reg.verifyToken(id, token)) {
        complain(
          `${id}|select-token`,
          `select of ${who(id)} refused: the browser's token is not the registered one`,
        );
        return res.status(403).json({
          error:
            "bad token — this engine registered with another token; reload the engine list",
        });
      }

      // WHO comes from the session, never from the body: a claim you can sign with someone else's name is not a claim.
      const holder = claimHolder(req);
      // Ownership before the claim rules: those only arbitrate between accounts that may use it — docs/ownership.md.
      const access = roleFor(id, holder);
      if (!mayUse(access) && !(access === "unowned" && holder)) {
        complain(
          `${id}|select-owner|${holder}`,
          `select of ${who(id)} refused: ${holder || "an anonymous session"} neither owns it nor was shared it`,
        );
        return res.status(403).json({
          error: "not-yours",
          message:
            "this engine belongs to another account, which has not shared it with you",
        });
      }
      const result = reg.claim(id, {
        project: project ?? null,
        holder,
        secret,
      });
      // 409 and not 403: nothing is wrong with the request, the project moved on, and the client's job is to let go and say so.
      // An OPEN with the token of an unowned engine is the first direct use: this account becomes its owner.
      if (result.ok && access === "unowned" && secret === undefined) {
        reg.owners.enrol(id, holder);
        reg.evict(id, (h) => h === holder);
      }
      if (!result.ok)
        return res.status(409).json({
          error: "project taken",
          heldBy: result.heldBy,
          // Which of the three it was; without it the browser can only say "opened elsewhere", which is false two times out of three.
          lost: result.lost,
          tookFor: result.tookFor,
        });
      res.json({
        ok: true,
        secret: result.secret,
        tookOver: result.tookOver,
      });
    }),
  );

  router.post(
    "/engine/release",
    validate(releaseBody),
    wrap((req, res) => {
      const { id, secret } = req.body as z.infer<typeof releaseBody>;
      // 200 either way: this arrives by `sendBeacon` from a page already going, so a refused goodbye just lets the claim expire.
      reg.release(id, secret);
      res.json({ ok: true });
    }),
  );

  return router;
}
