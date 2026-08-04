// Framework-free port of composables/useWebSocket.ts — a thin typed-event
// WebSocket client. Kept behaviour-identical: connect once, no auto-reconnect
// (the presenter is reloaded between shows; mid-show drops surface as a
// stalled screen the operator refreshes).

export interface WebSocketMessage {
  type: string;
  payload: any;
}

export type MessageHandler = (payload: any) => void;

export class PresenterSocket {
  private url: string;
  private ws: WebSocket | null = null;
  private handlers = new Map<string, MessageHandler[]>();

  constructor(url: string) {
    this.url = url;
  }

  on(type: string, callback: MessageHandler): void {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type)!.push(callback);
  }

  off(type: string, callback: MessageHandler): void {
    const list = this.handlers.get(type);
    if (list) {
      const idx = list.indexOf(callback);
      if (idx !== -1) list.splice(idx, 1);
    }
  }

  connect(): void {
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => console.log("WebSocket connected");
      this.ws.onmessage = (event) => {
        try {
          const data: WebSocketMessage = JSON.parse(event.data);
          const typeHandlers = this.handlers.get(data.type);
          if (typeHandlers) typeHandlers.forEach((cb) => cb(data.payload));
        } catch (e) {
          console.error("Error parsing WebSocket message:", e);
        }
      };
      this.ws.onerror = (e) => console.error("WebSocket error:", e);
      this.ws.onclose = () => console.log("WebSocket disconnected");
    } catch (e) {
      console.error("Error creating WebSocket:", e);
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send = (message: WebSocketMessage): void => {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error("WebSocket is not connected");
    }
  };
}
