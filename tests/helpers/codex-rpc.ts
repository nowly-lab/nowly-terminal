import WebSocket from "ws";
import { record } from "../../src/codex/events.js";
/** Codex's Unix transport uses WebSocket frames, without any TCP listener. */
export class CodexRpc {
  private next = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private dead = false;
  onNotification: (method: string, params: unknown) => void = () => {};
  onDisconnect: () => void = () => {};
  private constructor(
    private socket: WebSocket,
    private timeoutMs: number,
  ) {
    socket.on("message", (bytes) => {
      try {
        const frame = record(JSON.parse(bytes.toString()));
        if (typeof frame.method === "string") {
          // This is an observer; approvals belong to the interactive TUI. Do not
          // answer or auto-approve server requests on this connection.
          if (frame.id === undefined)
            this.onNotification(frame.method, frame.params);
        } else if (typeof frame.id === "number") {
          const p = this.pending.get(frame.id);
          if (!p) return;
          this.pending.delete(frame.id);
          clearTimeout(p.timer);
          if (frame.error)
            p.reject(
              Error(String(record(frame.error).message ?? "Codex RPC failed")),
            );
          else p.resolve(frame.result);
        }
      } catch {
        this.fail(Error("Invalid Codex event frame"));
      }
    });
    socket.on("error", () => this.fail(Error("Codex connection failed")));
    socket.on("close", () => this.fail(Error("Codex connection closed")));
  }
  static async connect(endpoint: string, timeoutMs = 15000) {
    const socket = new WebSocket(`ws+unix://${endpoint}:/`, {
      maxPayload: 64 * 1024 * 1024,
      handshakeTimeout: timeoutMs,
      perMessageDeflate: false,
    });
    const rpc = new CodexRpc(socket, timeoutMs);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
      socket.once("close", () => reject(Error("Codex connection closed")));
    });
    return rpc;
  }
  notify(method: string, params: unknown = {}) {
    if (this.dead || this.socket.readyState !== WebSocket.OPEN)
      throw Error("Codex disconnected");
    const data = JSON.stringify({ method, params });
    if (
      Buffer.byteLength(data) > 256 * 1024 ||
      this.socket.bufferedAmount > 1024 * 1024
    )
      throw Error("Codex request too large");
    this.socket.send(data);
  }
  request(method: string, params: unknown): Promise<any> {
    if (this.dead || this.socket.readyState !== WebSocket.OPEN)
      return Promise.reject(Error("Codex disconnected"));
    if (this.pending.size >= 32)
      return Promise.reject(Error("Too many Codex requests"));
    const id = ++this.next,
      data = JSON.stringify({ id, method, params });
    if (Buffer.byteLength(data) > 256 * 1024)
      return Promise.reject(Error("Codex request too large"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(Error("Codex request timeout")),
        this.timeoutMs,
      );
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(data);
    });
  }
  private fail(error: Error) {
    if (this.dead) return;
    this.dead = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.socket.terminate();
    this.onDisconnect();
  }
  dispose() {
    this.fail(Error("Codex connection disposed"));
  }
}
