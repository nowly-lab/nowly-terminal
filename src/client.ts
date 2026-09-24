import type {
  ConnectionStatus,
  Method,
  Requests,
  TerminalEvent,
  TerminalTransport,
} from "./protocol.js";
export interface WebSocketTransportOptions {
  url: string;
  token: string;
  reconnect?: boolean;
  requestTimeoutMs?: number;
}
export class WebSocketTransport implements TerminalTransport {
  status: ConnectionStatus = "connecting";
  private socket: WebSocket | null = null;
  private events = new Set<(event: TerminalEvent) => void>();
  private statuses = new Set<(status: ConnectionStatus) => void>();
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private nextId = 0;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private authTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(private options: WebSocketTransportOptions) {
    this.connect();
  }
  private setStatus(status: ConnectionStatus) {
    this.status = status;
    for (const fn of this.statuses) fn(status);
  }
  private connect() {
    if (this.status === "disposed") return;
    this.setStatus("connecting");
    const socket = new WebSocket(this.options.url);
    this.socket = socket;
    this.authTimer = setTimeout(() => socket.close(), 5000);
    socket.onopen = () =>
      socket.send(JSON.stringify({ type: "auth", token: this.options.token }));
    socket.onmessage = (event) => {
      if (socket !== this.socket) return;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        socket.close();
        return;
      }
      if (message.type === "ready") {
        if (message.version !== 1) {
          socket.close(1008, "Unsupported protocol");
          return;
        }
        clearTimeout(this.authTimer);
        this.retry = 0;
        this.setStatus("ready");
      } else if (
        message.type === "response" &&
        typeof message.requestId === "string"
      ) {
        const request = this.pending.get(message.requestId);
        if (!request) return;
        this.pending.delete(message.requestId);
        clearTimeout(request.timer);
        if (typeof message.error === "string")
          request.reject(new Error(message.error));
        else request.resolve(message.result);
      } else if (
        ["snapshot", "data", "resize", "exit", "closed"].includes(
          String(message.type),
        ) &&
        typeof message.sessionId === "string"
      ) {
        for (const fn of this.events) fn(message as unknown as TerminalEvent);
      }
    };
    socket.onerror = () => {};
    socket.onclose = (event) => {
      if (socket !== this.socket) return;
      clearTimeout(this.authTimer);
      this.rejectPending();
      if (this.status === "disposed") return;
      this.setStatus("disconnected");
      if (this.options.reconnect !== false && event.code !== 1008) {
        this.retryTimer = setTimeout(
          () => this.connect(),
          Math.min(5000, 250 * 2 ** this.retry++),
        );
      }
    };
  }
  private rejectPending() {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Terminal disconnected"));
    }
    this.pending.clear();
  }
  ready(timeoutMs = this.options.requestTimeoutMs ?? 10000): Promise<void> {
    if (this.status === "ready") return Promise.resolve();
    if (this.status === "disposed")
      return Promise.reject(new Error("Transport disposed"));
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        unsubscribe();
        error ? reject(error) : resolve();
      };
      const unsubscribe = this.onStatus((status) => {
        if (status === "ready") finish();
        else if (status === "disposed") finish(new Error("Transport disposed"));
      });
      const timer = setTimeout(
        () => finish(new Error("Connection timed out")),
        timeoutMs,
      );
    });
  }
  request<M extends Method>(
    method: M,
    params: Requests[M]["params"],
  ): Promise<Requests[M]["result"]> {
    if (this.status !== "ready" || !this.socket)
      return Promise.reject(new Error("Terminal disconnected"));
    const requestId = String(++this.nextId);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Request timed out"));
      }, this.options.requestTimeoutMs ?? 10000);
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as Requests[M]["result"]),
        reject,
        timer,
      });
      try {
        this.socket!.send(JSON.stringify({ requestId, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }
  subscribe(listener: (event: TerminalEvent) => void) {
    this.events.add(listener);
    return () => {
      this.events.delete(listener);
    };
  }
  onStatus(listener: (status: ConnectionStatus) => void) {
    this.statuses.add(listener);
    return () => {
      this.statuses.delete(listener);
    };
  }
  reconnect() {
    if (this.status === "disposed") return;
    clearTimeout(this.retryTimer);
    clearTimeout(this.authTimer);
    const old = this.socket;
    this.socket = null;
    old?.close();
    this.rejectPending();
    this.connect();
  }
  dispose() {
    if (this.status === "disposed") return;
    this.setStatus("disposed");
    clearTimeout(this.retryTimer);
    clearTimeout(this.authTimer);
    this.rejectPending();
    this.socket?.close();
    this.socket = null;
    this.events.clear();
    this.statuses.clear();
  }
}
