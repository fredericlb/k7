import { useSyncExternalStore } from "react";

// Framework-free port of composables/useVirtualBuzzers.ts: each virtual
// buzzer is its own /ws/buzzer connection with a persisted token, so the
// backend rebinds it to the same player across reloads (token → deviceId).

export interface VirtualBuzzer {
  name: string;
  token: string;
  deviceId: string | null;
  connected: boolean;
  registered: boolean;
  error: string | null;
  socket: WebSocket | null;
  serverTimeOffset: number;
}

export interface VirtualBuzzersState {
  buzzers: VirtualBuzzer[];
}

const STORAGE_KEY = "monitor_virtual_buzzers";

interface StoredEntry {
  name: string;
  token: string;
}

function loadStored(): StoredEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StoredEntry[];
  } catch {
    /* corrupt — start fresh */
  }
  return [];
}

function newToken(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
}

function wsURL(token: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws/buzzer?token=${encodeURIComponent(token)}`;
}

export class VirtualBuzzers {
  private buzzers: VirtualBuzzer[] = [];
  private state: VirtualBuzzersState = { buzzers: [] };
  private listeners = new Set<() => void>();
  private started = false;

  subscribeState = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getState = (): VirtualBuzzersState => this.state;

  private emit(): void {
    // Buzzer objects are mutated in place by socket handlers; refresh both
    // array and snapshot identity so useSyncExternalStore re-renders.
    this.state = { buzzers: this.buzzers.map((b) => ({ ...b })) };
    for (const l of this.listeners) l();
  }

  private persist(): void {
    const list: StoredEntry[] = this.buzzers.map((b) => ({
      name: b.name,
      token: b.token,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  private sendRegister(b: VirtualBuzzer): void {
    if (!b.socket || b.socket.readyState !== WebSocket.OPEN) return;
    b.socket.send(
      JSON.stringify({ type: "register", payload: { name: b.name } }),
    );
  }

  private openSocket(b: VirtualBuzzer, registerOnWelcome: boolean): void {
    const sock = new WebSocket(wsURL(b.token));
    b.socket = sock;
    sock.onmessage = (ev) => {
      let msg: { type?: string; payload?: Record<string, unknown> };
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      switch (msg.type) {
        case "welcome": {
          const p = msg.payload as unknown as {
            deviceId: string;
            serverTimestamp: number;
          };
          b.deviceId = p.deviceId;
          b.connected = true;
          b.serverTimeOffset = p.serverTimestamp - Date.now();
          if (registerOnWelcome) this.sendRegister(b);
          break;
        }
        case "registered":
          b.registered = true;
          b.error = null;
          break;
        case "unregistered":
          b.registered = false;
          // Token was preserved but the device is no longer bound to a
          // player in the current game — re-register under the same name.
          this.sendRegister(b);
          break;
        case "register_error":
          b.error = (msg.payload?.error as string) ?? "register failed";
          break;
        default:
          return;
      }
      this.emit();
    };
    sock.onclose = () => {
      b.connected = false;
      b.registered = false;
      b.socket = null;
      this.emit();
    };
  }

  /**
   * Restore persisted buzzers: reopen each token; the backend rebinds by
   * token → deviceId, so the player reattaches automatically. If the device
   * no longer maps to a player (new game), the `unregistered` handler
   * re-sends register. Deferred out of the constructor so a StrictMode
   * double-mount doesn't open sockets twice.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    for (const stored of loadStored()) {
      const b: VirtualBuzzer = {
        name: stored.name,
        token: stored.token,
        deviceId: null,
        connected: false,
        registered: false,
        error: null,
        socket: null,
        serverTimeOffset: 0,
      };
      this.buzzers.push(b);
      this.openSocket(b, false);
    }
    this.emit();
  }

  create(rawName: string): string | null {
    const name = rawName.trim();
    if (!name) return "name required";
    if (this.buzzers.some((b) => b.name.toLowerCase() === name.toLowerCase())) {
      return "already exists";
    }
    const b: VirtualBuzzer = {
      name,
      token: newToken(),
      deviceId: null,
      connected: false,
      registered: false,
      error: null,
      socket: null,
      serverTimeOffset: 0,
    };
    this.buzzers.push(b);
    this.persist();
    this.openSocket(b, true);
    this.emit();
    return null;
  }

  buzz(name: string): void {
    const b = this.buzzers.find((x) => x.name === name);
    if (!b || !b.socket || b.socket.readyState !== WebSocket.OPEN) return;
    const timestamp = Date.now() + b.serverTimeOffset;
    b.socket.send(JSON.stringify({ type: "buzz", payload: { timestamp } }));
  }

  join(name: string): void {
    const b = this.buzzers.find((x) => x.name === name);
    if (!b) return;
    this.sendRegister(b);
  }

  remove(name: string): void {
    const idx = this.buzzers.findIndex((x) => x.name === name);
    if (idx === -1) return;
    const b = this.buzzers[idx];
    if (b.socket) {
      b.socket.onclose = null;
      try {
        b.socket.close();
      } catch {
        /* ignore */
      }
    }
    this.buzzers.splice(idx, 1);
    this.persist();
    this.emit();
  }

  dispose(): void {
    for (const b of this.buzzers) {
      if (b.socket) {
        b.socket.onclose = null;
        try {
          b.socket.close();
        } catch {
          /* ignore */
        }
        b.socket = null;
      }
    }
    this.buzzers = [];
    this.started = false;
    this.emit();
  }
}

export function useVirtualBuzzersState(v: VirtualBuzzers): VirtualBuzzersState {
  return useSyncExternalStore(v.subscribeState, v.getState);
}
