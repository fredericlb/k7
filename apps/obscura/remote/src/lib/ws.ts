// Framework-free WebSocket wrapper (port of the buzzer's useWebSocket
// composable): typed message dispatch + a connection flag exposed via
// subscribe so React reads it with useSyncExternalStore.

export interface WsMessage {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MessageHandler = (payload: any) => void;

export class BuzzerSocket {
  private ws: WebSocket | null = null;
  private connected = false;
  private handlers = new Map<string, MessageHandler[]>();
  private listeners = new Set<() => void>();

  constructor(private url: string) {}

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  isConnected = (): boolean => this.connected;

  private setConnected(v: boolean): void {
    if (this.connected === v) return;
    this.connected = v;
    for (const l of this.listeners) l();
  }

  on(type: string, callback: MessageHandler): void {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type)!.push(callback);
  }

  connect(): void {
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => this.setConnected(true);
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as WsMessage;
          for (const cb of this.handlers.get(data.type) ?? []) cb(data.payload);
        } catch (e) {
          console.error("Error parsing WebSocket message:", e);
        }
      };
      this.ws.onerror = (e) => console.error("WebSocket error:", e);
      this.ws.onclose = () => this.setConnected(false);
    } catch (e) {
      console.error("Error creating WebSocket:", e);
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.setConnected(false);
    }
  }

  send(message: WsMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error("WebSocket is not connected");
    }
  }
}
