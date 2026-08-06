import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { sessionFromCookieHeader } from "@frediverse/oidc";
import { WebSocket, WebSocketServer } from "ws";
import {
  getAuthConfig,
  isAdmin,
  SESSION_COOKIE_NAME,
  type SessionUser,
  studioUser,
} from "./auth/session.ts";
import {
  broadcastDeviceBuzz,
  broadcastPlayerAdded,
  broadcastPlayerBuzz,
  enqueueBuzz,
  setServerPhase,
} from "./game/phase.ts";
import { gameState, serverRelativeNow } from "./gameState.ts";
import { saveBuzzerState } from "./state/persist.ts";

export interface WsMessage {
  type: string;
  payload?: unknown;
}

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

/**
 * Connection hub + message dispatch for the two WebSocket surfaces
 * (main.go's handleWebSocket / handleBuzzerWebSocket):
 *   /ws         — main-screen clients (presenter, monitor, remote)
 *   /ws/buzzer  — phone buzzers, each tagged with its deviceId
 *
 * `ws` serializes writes per connection internally, so Go's per-conn write
 * mutex (safeWriteJSON) collapses into plain send() calls.
 */
export class WsHub {
  private main = new WebSocketServer({ noServer: true });
  private buzzer = new WebSocketServer({ noServer: true });
  private mainClients = new Set<WebSocket>();
  private buzzerClients = new Map<WebSocket, string>(); // conn -> deviceId
  private heartbeat: NodeJS.Timeout | null = null;

  constructor() {
    this.main.on("connection", (conn) => this.onMainConnection(conn));
    this.buzzer.on("connection", (conn, req: IncomingMessage) =>
      this.onBuzzerConnection(conn, req),
    );
    // Periodic heartbeat to main clients (main.go broadcastMessages).
    this.heartbeat = setInterval(() => {
      if (this.mainClients.size > 0) {
        this.broadcastMain({
          type: "heartbeat",
          payload: {
            timestamp: new Date().toISOString(),
            clients: this.mainClients.size,
          },
        });
      }
    }, 10_000);
    this.heartbeat.unref?.();
  }

  /**
   * Route an HTTP upgrade to the right endpoint. Auth mirrors the Go stack:
   * both endpoints sit behind the session cookie (the /ws paths are not
   * public), and main-WS clients identifying as monitor/remote must be admin.
   */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname;
    const server =
      path === "/ws" ? this.main : path === "/ws/buzzer" ? this.buzzer : null;
    if (!server) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    // An upgrade is a raw http event, so cookie-session's middleware never ran
    // and there is no req.session — decode the cookies ourselves. Same order as
    // currentUser(): the studio account first, the guest cookie second.
    const u =
      studioUser(req.headers.cookie) ??
      (sessionFromCookieHeader(req.headers.cookie, {
        cookieName: SESSION_COOKIE_NAME,
        secret: getAuthConfig().sessionSecret,
      }) as SessionUser | null);
    if (!u) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const role = url.searchParams.get("role") ?? "";
    if (
      path === "/ws" &&
      (role === "monitor" || role === "remote") &&
      !isAdmin(u)
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    server.handleUpgrade(req, socket, head, (conn) => {
      server.emit("connection", conn, req);
    });
  }

  // ─── Main-screen endpoint (/ws) ───────────────────────────────────────────

  private onMainConnection(conn: WebSocket): void {
    this.mainClients.add(conn);
    const drop = () => {
      this.mainClients.delete(conn);
      console.log(
        `Client disconnected. Total clients: ${this.mainClients.size}`,
      );
    };
    conn.on("close", drop);
    conn.on("error", drop);
    console.log(`Client connected. Total clients: ${this.mainClients.size}`);

    const game = gameState.currentGame;
    this.send(conn, {
      type: "connected",
      payload: {
        message: "Connected to WebSocket server",
        gameSelected: gameState.gameSelected && game !== null,
        registrationStarted: gameState.registrationStarted,
        registrationComplete: gameState.registrationComplete,
        gameId: game?.id ?? "",
        playerCount: game?.players.length ?? 0,
      },
    });

    conn.on("message", (raw) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(String(raw)) as WsMessage;
      } catch {
        return;
      }
      this.dispatchMain(conn, msg);
    });
  }

  private dispatchMain(conn: WebSocket, msg: WsMessage): void {
    switch (msg.type) {
      case "ping":
        this.send(conn, {
          type: "pong",
          payload: { timestamp: new Date().toISOString() },
        });
        break;
      case "echo":
        this.send(conn, { type: "echo", payload: msg.payload });
        break;
      case "lock_buzzers":
      case "unlock_buzzers":
      case "phase_change":
        // Phase/lock ownership is server-side; clients emitting these are
        // legacy or racy. Logged, ignored.
        console.log(
          `[PhaseTrace] ignoring deprecated client emit type=${msg.type}`,
        );
        break;
      case "lock_device": {
        const pm = asRecord(msg.payload);
        const did = String(pm.deviceId ?? "");
        const durationMs =
          typeof pm.durationMs === "number" ? pm.durationMs : 0;
        const reason = typeof pm.reason === "string" ? pm.reason : "";
        gameState.deviceCooldowns.set(did, Date.now() + durationMs);
        if (reason) gameState.deviceCooldownReasons.set(did, reason);
        else gameState.deviceCooldownReasons.delete(did);
        const payload: Record<string, unknown> = { locked: true, durationMs };
        if (reason) payload.reason = reason;
        this.notifyBuzzerDevice(did, { type: "buzzer_locked", payload });
        console.log(`[WS] Device ${did} locked for ${durationMs}ms`);
        break;
      }
      case "remote_action": {
        const pm = asRecord(msg.payload);
        const action = typeof pm.action === "string" ? pm.action : "";
        if (action) console.log(`[PhaseTrace] remote_action action=${action}`);
        this.broadcastMain({ type: "remote_action", payload: msg.payload });
        // Server-driven transitions for racy actions: validating against the
        // current phase makes duplicate actions from concurrent remotes no-ops.
        const cur = gameState.currentPhase;
        switch (action) {
          case "score_and_reveal":
          case "no_winner":
            if (cur === "answering") setServerPhase("reveal");
            break;
          case "bad_response":
          case "multi_score":
          case "multi_no_winner":
            if (cur === "answering") setServerPhase("song");
            break;
        }
        break;
      }
      case "preload_progress":
      case "preload_failed":
      case "playback_state":
      case "audio_command":
        // Pure pass-throughs between main-screen clients.
        this.broadcastMain({ type: msg.type, payload: msg.payload });
        break;
      case "debug_buzz": {
        const pm = asRecord(msg.payload);
        const did = String(pm.deviceId ?? "");
        if (!gameState.gameSelected || !gameState.currentGame) break;
        const cooldownUntil = gameState.deviceCooldowns.get(did) ?? 0;
        if (!gameState.buzzersLocked && Date.now() >= cooldownUntil) {
          const player = gameState.currentGame.players.find(
            (p) => p.deviceId === did,
          );
          if (player) {
            enqueueBuzz(player.name, did, serverRelativeNow());
            console.log(`[WS] Debug buzz: ${did} (${player.name})`);
          }
        }
        break;
      }
      default:
        this.send(conn, { type: "ack", payload: { received: msg.type } });
    }
  }

  // ─── Buzzer endpoint (/ws/buzzer) ─────────────────────────────────────────

  private onBuzzerConnection(conn: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url ?? "/", "http://x");
    const token = url.searchParams.get("token") ?? "";

    // Token-based reconnection: a restored token re-binds the same device id.
    let deviceId = "";
    let reconnected = false;
    if (token && gameState.buzzerTokens.has(token)) {
      deviceId = gameState.buzzerTokens.get(token)!;
      reconnected = true;
    }
    if (deviceId === "") {
      gameState.phoneCounter += 1;
      deviceId = `P${gameState.phoneCounter}`;
    }
    if (token) gameState.buzzerTokens.set(token, deviceId);
    saveBuzzerState();

    this.buzzerClients.set(conn, deviceId);
    console.log(
      `[Buzzer] Phone ${deviceId} connected (reconnected=${reconnected}, token=${token})`,
    );

    this.broadcastMain({ type: "device_connected", payload: { deviceId } });

    const game = gameState.currentGame;
    const hasGame = gameState.gameSelected && game !== null;
    this.send(conn, {
      type: "welcome",
      payload: {
        deviceId,
        gameSelected: hasGame,
        registrationStarted: gameState.registrationStarted,
        registrationComplete: gameState.registrationComplete,
        reconnected,
        serverTimestamp: serverRelativeNow(),
        gameId: game?.id ?? "",
      },
    });

    // On reconnect: re-send the player binding, or tell the phone its stale
    // token doesn't match any player in the current game.
    if (reconnected && hasGame) {
      const player = game!.players.find((p) => p.deviceId === deviceId);
      if (player) {
        this.send(conn, {
          type: "registered",
          payload: { playerName: player.name, score: player.score },
        });
        console.log(
          `[Buzzer] ${deviceId} auto-bound to player ${player.name} (score=${player.score})`,
        );
      } else {
        this.send(conn, { type: "unregistered", payload: { deviceId } });
        console.log(
          `[Buzzer] ${deviceId} reconnected but not registered in current game`,
        );
      }
    }

    conn.on("message", (raw) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(String(raw)) as WsMessage;
      } catch {
        return;
      }
      if (!gameState.gameSelected || !gameState.currentGame) {
        this.send(conn, {
          type: "no_game",
          payload: { error: "no game selected" },
        });
        return;
      }
      this.dispatchBuzzer(conn, deviceId, msg);
    });

    const drop = () => {
      this.buzzerClients.delete(conn);
      this.broadcastMain({
        type: "device_disconnected",
        payload: { deviceId },
      });
      console.log(`[Buzzer] Phone ${deviceId} removed`);
    };
    conn.on("close", drop);
    conn.on("error", drop);
  }

  private dispatchBuzzer(
    conn: WebSocket,
    deviceId: string,
    msg: WsMessage,
  ): void {
    const game = gameState.currentGame!;
    switch (msg.type) {
      case "buzz": {
        const player = game.players.find((p) => p.deviceId === deviceId);
        if (!player) {
          // Unregistered device: ask for a name.
          this.send(conn, { type: "name_required", payload: { deviceId } });
          console.log(
            `[Buzzer] ${deviceId} buzzed (unregistered, asking for name)`,
          );
          break;
        }
        if (gameState.registrationStarted && !gameState.registrationComplete) {
          // Registered but game hasn't started: flash the name on the presenter.
          broadcastDeviceBuzz(deviceId);
          broadcastPlayerBuzz(player.name, deviceId);
          console.log(
            `[Buzzer] ${deviceId} buzzed (registration, ${player.name})`,
          );
          break;
        }
        // Game in progress.
        const cooldownUntil = gameState.deviceCooldowns.get(deviceId) ?? 0;
        if (gameState.buzzersLocked || Date.now() < cooldownUntil) {
          const reason = gameState.buzzersLocked ? "locked" : "cooldown";
          console.log(
            `[PhaseTrace] buzz_rejected device=${deviceId} reason=${reason}`,
          );
          this.send(conn, { type: "buzz_rejected", payload: { reason } });
          break;
        }
        const pm = asRecord(msg.payload);
        let buzzTs =
          typeof pm.timestamp === "number" ? Math.trunc(pm.timestamp) : 0;
        if (buzzTs === 0) buzzTs = serverRelativeNow();
        // Reject buzzes stamped >5s before the question started.
        const qStart = gameState.questionStartedAt;
        if (qStart > 0 && buzzTs < qStart - 5000) {
          console.log(
            `[Buzzer] ${deviceId} buzz rejected (timestamp ${buzzTs} too early, question at ${qStart})`,
          );
          this.send(conn, {
            type: "buzz_rejected",
            payload: { reason: "too_early" },
          });
          break;
        }
        enqueueBuzz(player.name, deviceId, buzzTs);
        console.log(
          `[Buzzer] ${deviceId} buzzed (${player.name}, ts=${buzzTs})`,
        );
        break;
      }
      case "register": {
        const pm = asRecord(msg.payload);
        const name = String(pm.name ?? "").trim();
        if (name === "") {
          this.send(conn, {
            type: "register_error",
            payload: { error: "name is required" },
          });
          break;
        }
        if (!gameState.registrationStarted) {
          this.send(conn, {
            type: "register_error",
            payload: { error: "registration has not started yet" },
          });
          break;
        }
        // A same-named player with no bound device re-binds instead of
        // erroring — allowed even after registration locks, so a player whose
        // buzzer died mid-game can move to a fresh device.
        const existingUnlinked = game.players.some(
          (p) =>
            p.name.toLowerCase() === name.toLowerCase() && p.deviceId === "",
        );
        if (!existingUnlinked && gameState.registrationComplete) {
          this.send(conn, {
            type: "register_error",
            payload: { error: "registration is already complete" },
          });
          break;
        }
        try {
          if (existingUnlinked) {
            gameState.db!.rebindPlayerDevice(game.id, name, deviceId);
          } else {
            gameState.db!.addPlayer(game.id, name, deviceId);
          }
        } catch (err) {
          this.send(conn, {
            type: "register_error",
            payload: {
              error: err instanceof Error ? err.message : String(err),
            },
          });
          break;
        }
        gameState.currentGame = gameState.db!.getGame(game.id);
        const score =
          gameState.currentGame.players.find(
            (p) => p.name.toLowerCase() === name.toLowerCase(),
          )?.score ?? 0;
        this.send(conn, {
          type: "registered",
          payload: { playerName: name, score },
        });
        broadcastPlayerAdded(name, deviceId);
        console.log(`[Buzzer] ${deviceId} registered as ${name}`);
        break;
      }
    }
  }

  // ─── Broadcast API ────────────────────────────────────────────────────────

  private send(conn: WebSocket, msg: WsMessage): void {
    if (conn.readyState === WebSocket.OPEN) conn.send(JSON.stringify(msg));
  }

  broadcastMain(msg: WsMessage): void {
    const raw = JSON.stringify(msg);
    for (const c of this.mainClients)
      if (c.readyState === WebSocket.OPEN) c.send(raw);
  }

  broadcastBuzzers(msg: WsMessage): void {
    const raw = JSON.stringify(msg);
    for (const c of this.buzzerClients.keys())
      if (c.readyState === WebSocket.OPEN) c.send(raw);
  }

  /** Send to every buzzer whose deviceId is NOT in the excluded set. */
  broadcastBuzzersExcept(excluded: Map<string, number>, msg: WsMessage): void {
    const raw = JSON.stringify(msg);
    for (const [c, id] of this.buzzerClients) {
      if (excluded.has(id)) continue;
      if (c.readyState === WebSocket.OPEN) c.send(raw);
    }
  }

  notifyBuzzerDevice(deviceId: string, msg: WsMessage): void {
    for (const [c, id] of this.buzzerClients) {
      if (id === deviceId) {
        this.send(c, msg);
        return;
      }
    }
  }

  /** Tell a device it's now registered as playerName (main.go notifyBuzzerClient). */
  notifyRegistered(deviceId: string, playerName: string): void {
    this.notifyBuzzerDevice(deviceId, {
      type: "registered",
      payload: { playerName },
    });
  }

  connectedBuzzerDevices(): string[] {
    return [...this.buzzerClients.values()];
  }

  counts(): { main: number; buzzer: number } {
    return { main: this.mainClients.size, buzzer: this.buzzerClients.size };
  }

  close(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const c of this.mainClients) c.terminate();
    for (const c of this.buzzerClients.keys()) c.terminate();
    this.main.close();
    this.buzzer.close();
  }
}
