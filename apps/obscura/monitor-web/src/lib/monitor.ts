import { useSyncExternalStore } from "react";
import { f } from "./api";

// Framework-free port of composables/useMonitor.ts: inline WS client on
// /ws?role=monitor with 1s auto-reconnect, a 5s /api/game refresh poll, a
// capped log of inbound traffic, and a subscribe() fan-out other modules
// (audio, game state, mic) hook into. The Vue refs became an immutable
// snapshot + listeners for useSyncExternalStore.

export interface Player {
  name: string;
  deviceId?: string;
  score: number;
}

export interface WSEntry {
  id: number;
  ts: string;
  type: string;
  payload: string;
  direction: "in" | "info";
}

interface GameInfo {
  id?: string;
  gameSelected?: boolean;
  phase?: string;
  players?: Player[];
}

export interface MonitorState {
  phase: string;
  song: string;
  players: Player[];
  wsEntries: WSEntry[];
  connected: boolean;
  wsURL: string;
  buzzing: Set<string>;
}

const MAX_WS_ENTRIES = 500;

function fmtTime(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export type WSMessage = { type: string; payload: Record<string, unknown> };
export type WSSubscriber = (msg: WSMessage) => void;

export class MonitorClient {
  private state: MonitorState = {
    phase: "",
    song: "",
    players: [],
    wsEntries: [],
    connected: false,
    wsURL: "",
    buzzing: new Set(),
  };
  private listeners = new Set<() => void>();
  private buzzTimers = new Map<string, number>();

  private entrySeq = 0;
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private pollTimer: number | null = null;
  private subscribers = new Set<WSSubscriber>();

  subscribeState = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getState = (): MonitorState => this.state;

  private set(patch: Partial<MonitorState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** Fan-out for other modules — receives every parsed WS message. */
  subscribe = (fn: WSSubscriber): (() => void) => {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  };

  private logEntry(
    type: string,
    payload: unknown,
    direction: WSEntry["direction"] = "in",
  ): void {
    const text =
      payload === undefined || payload === null
        ? ""
        : typeof payload === "string"
          ? payload
          : JSON.stringify(payload);
    const entries = [
      ...this.state.wsEntries,
      {
        id: ++this.entrySeq,
        ts: fmtTime(),
        type,
        payload: text.length > 280 ? text.slice(0, 279) + "…" : text,
        direction,
      },
    ];
    if (entries.length > MAX_WS_ENTRIES)
      entries.splice(0, entries.length - MAX_WS_ENTRIES);
    this.set({ wsEntries: entries });
  }

  private async fetchGame(): Promise<GameInfo | null> {
    try {
      const r = await f("/api/game", { cache: "no-store" });
      if (!r.ok) return null;
      return (await r.json()) as GameInfo;
    } catch {
      return null;
    }
  }

  private applyGame(info: GameInfo | null): void {
    if (!info) return;
    const patch: Partial<MonitorState> = {};
    if (info.phase) patch.phase = info.phase;
    if (Array.isArray(info.players)) {
      patch.players = info.players.map((p) => ({
        name: p.name,
        deviceId: p.deviceId,
        score: p.score ?? 0,
      }));
    }
    if (Object.keys(patch).length > 0) this.set(patch);
  }

  private setPlayerScore(name: string, score: number): void {
    const players = [...this.state.players];
    const idx = players.findIndex((p) => p.name === name);
    if (idx >= 0) players[idx] = { ...players[idx], score };
    else players.push({ name, score });
    this.set({ players });
  }

  private handleMessage(raw: string): void {
    let msg: { type?: string; payload?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      this.logEntry("?", raw);
      return;
    }
    const type = msg.type ?? "?";
    const payload = (msg.payload ?? {}) as Record<string, unknown>;
    this.logEntry(type, payload);

    for (const sub of this.subscribers) {
      try {
        sub({ type, payload });
      } catch (e) {
        console.error("ws subscriber:", e);
      }
    }

    switch (type) {
      case "phase_change": {
        const p = payload.phase as string | undefined;
        if (p) this.set({ phase: p });
        break;
      }
      case "next": {
        const t = payload.type as string | undefined;
        const songObj = payload.song as
          | { artist?: string; title?: string; label?: string }
          | undefined;
        const cat = payload.category as { name?: string } | undefined;
        const catName =
          (payload.categoryName as string | undefined) ?? cat?.name ?? "";
        if (t === "song" && songObj) {
          const label =
            songObj.label ?? `${songObj.artist ?? ""} — ${songObj.title ?? ""}`;
          this.set({ song: catName ? `[${catName}] ${label}` : label });
        } else if (t === "category") {
          this.set({ song: `intro — ${catName}` });
        } else if (t === "end") {
          this.set({ song: "— session ended —" });
        }
        break;
      }
      case "bump": {
        // Backend doesn't send delta, refresh from HTTP.
        void this.fetchGame().then((info) => this.applyGame(info));
        break;
      }
      case "score_set": {
        const name = payload.player as string | undefined;
        const score = payload.score as number | undefined;
        if (name && typeof score === "number") this.setPlayerScore(name, score);
        break;
      }
      case "player_added": {
        const name = payload.playerName as string | undefined;
        const deviceId = payload.deviceId as string | undefined;
        if (name && !this.state.players.some((p) => p.name === name)) {
          this.set({
            players: [...this.state.players, { name, deviceId, score: 0 }],
          });
        }
        break;
      }
      case "player_buzz": {
        const name = payload.playerName as string | undefined;
        if (name) {
          const next = new Set(this.state.buzzing);
          next.add(name);
          this.set({ buzzing: next });
          const prev = this.buzzTimers.get(name);
          if (prev) window.clearTimeout(prev);
          this.buzzTimers.set(
            name,
            window.setTimeout(() => {
              const after = new Set(this.state.buzzing);
              after.delete(name);
              this.set({ buzzing: after });
              this.buzzTimers.delete(name);
            }, 1000),
          );
        }
        break;
      }
      case "welcome": {
        void this.fetchGame().then((info) => this.applyGame(info));
        break;
      }
    }
  }

  private connect(): void {
    if (this.socket) return;
    const url = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws?role=monitor`;
    this.set({ wsURL: url });
    this.logEntry("ws", `connecting to ${url}…`, "info");
    const s = new WebSocket(url);
    this.socket = s;
    s.onopen = () => {
      this.set({ connected: true });
      this.logEntry("ws", "connected", "info");
      void this.fetchGame().then((info) => this.applyGame(info));
    };
    s.onmessage = (ev) =>
      this.handleMessage(typeof ev.data === "string" ? ev.data : "");
    s.onerror = () => this.logEntry("ws", "error", "info");
    s.onclose = () => {
      this.set({ connected: false });
      this.socket = null;
      this.logEntry("ws", "disconnected — retrying in 1s", "info");
      this.reconnectTimer = window.setTimeout(() => this.connect(), 1000);
    };
  }

  sendWS = (msg: { type: string; payload: unknown }): void => {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    try {
      this.socket.send(JSON.stringify(msg));
    } catch (e) {
      console.error("ws send:", e);
    }
  };

  start(): void {
    this.connect();
    void this.fetchGame().then((info) => this.applyGame(info));
    this.pollTimer = window.setInterval(() => {
      void this.fetchGame().then((info) => this.applyGame(info));
    }, 5000);
  }

  stop(): void {
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    if (this.pollTimer) window.clearInterval(this.pollTimer);
    for (const t of this.buzzTimers.values()) window.clearTimeout(t);
    this.buzzTimers.clear();
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
  }
}

export function useMonitorState(m: MonitorClient): MonitorState {
  return useSyncExternalStore(m.subscribeState, m.getState);
}
