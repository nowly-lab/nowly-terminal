import { connect, type Socket } from "node:net";
import type {
  ConnectionStatus,
  Method,
  Requests,
  TerminalEvent,
  TerminalTransport,
} from "../protocol.js";
import {
  type Descriptor,
  type DaemonInfo,
  PROTOCOL_VERSION,
  readDescriptor,
  runtimeDirectory,
} from "./metadata.js";
import {
  readFrames,
  sendFrame,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
} from "./wire.js";
export class DaemonClient implements TerminalTransport {
  private socket: Socket;
  private state: ConnectionStatus = "connecting";
  private events = new Set<(event: TerminalEvent) => void>();
  private statuses = new Set<(status: ConnectionStatus) => void>();
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private nextId = 0;
  private connected: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private readyTimer: ReturnType<typeof setTimeout>;
  constructor(private descriptor: Descriptor) {
    this.connected = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    void this.connected.catch(() => {});
    this.socket = connect(descriptor.endpoint);
    this.readyTimer = setTimeout(
      () => this.fail(Error("Daemon connection timeout")),
      3000,
    );
    this.socket.once("connect", () =>
      sendFrame(
        this.socket,
        { type: "auth", version: PROTOCOL_VERSION, token: descriptor.token },
        MAX_REQUEST_BYTES,
      ),
    );
    this.socket.on("error", (error) => this.fail(error));
    this.socket.once("close", () => this.fail(Error("Daemon disconnected")));
    readFrames(this.socket, MAX_RESPONSE_BYTES, (frame) => {
      if (frame.type === "ready" && this.state === "connecting") {
        if (
          frame.version !== PROTOCOL_VERSION ||
          frame.instanceId !== descriptor.instanceId
        )
          throw Error("Incompatible daemon");
        clearTimeout(this.readyTimer);
        this.setStatus("ready");
        this.resolveReady();
        return;
      }
      if (this.state !== "ready") throw Error("Daemon is not authenticated");
      if (frame.type === "response") {
        const pending = this.pending.get(Number(frame.requestId));
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(Number(frame.requestId));
        if (typeof frame.error === "string") pending.reject(Error(frame.error));
        else pending.resolve(frame.result);
        return;
      }
      if (
        ["snapshot", "data", "resize", "exit", "closed", "agent"].includes(
          String(frame.type),
        ) &&
        typeof frame.sessionId === "string"
      )
        for (const listener of this.events) {
          try {
            listener(frame as unknown as TerminalEvent);
          } catch {}
        }
    });
  }
  get status() {
    return this.state;
  }
  info(): DaemonInfo {
    return {
      version: this.descriptor.version,
      pid: this.descriptor.pid,
      instanceId: this.descriptor.instanceId,
    };
  }
  ready() {
    return this.connected;
  }
  private setStatus(status: ConnectionStatus) {
    if (this.state === status) return;
    this.state = status;
    for (const listener of this.statuses) {
      try {
        listener(status);
      } catch {}
    }
  }
  private fail(error: Error) {
    clearTimeout(this.readyTimer);
    this.rejectReady(error);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    if (this.state !== "disposed") this.setStatus("disconnected");
    this.socket.destroy();
  }
  private async call(method: string, params: unknown): Promise<any> {
    await this.ready();
    if (this.state !== "ready") throw Error("Daemon disconnected");
    if (this.pending.size >= 64) throw Error("Too many pending requests");
    const requestId = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(Error("Daemon request timeout")),
        method === "create" ? 30000 : 10000,
      );
      this.pending.set(requestId, { resolve, reject, timer });
      if (
        !sendFrame(
          this.socket,
          { requestId, method, params },
          MAX_REQUEST_BYTES,
        )
      )
        this.fail(Error("Daemon request too large or disconnected"));
    });
  }
  request<M extends Method>(
    method: M,
    params: Requests[M]["params"],
  ): Promise<Requests[M]["result"]> {
    return this.call(method, params);
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
  async shutdown() {
    await this.call("shutdown", {});
  }
  dispose() {
    this.setStatus("disposed");
    this.fail(Error("Daemon client disposed"));
    this.events.clear();
    this.statuses.clear();
  }
}
export async function connectTerminalDaemon(runtimeDir: string) {
  const descriptor = readDescriptor(runtimeDirectory(runtimeDir));
  if (!descriptor) throw Error("No terminal daemon is running");
  const client = new DaemonClient(descriptor);
  try {
    await client.ready();
    return client;
  } catch (error) {
    client.dispose();
    throw error;
  }
}
