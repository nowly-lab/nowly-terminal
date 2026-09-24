import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { TerminalHost, type HostOptions } from "./host.js";
import { validId, validSize, MAX_INPUT_LENGTH } from "../protocol.js";
export interface ServerOptions {
  token: string;
  allowedOrigins: string[];
  port?: number;
  hostname?: string;
  hostOptions?: HostOptions;
}
export async function createTerminalServer(options: ServerOptions) {
  if (!options.token) throw new Error("A nonempty token is required");
  const host = new TerminalHost(options.hostOptions);
  const http = createServer((req, res) => {
    res.writeHead(req.url === "/health" ? 200 : 404, {
      "Content-Type": "text/plain",
    });
    res.end(req.url === "/health" ? "ok" : "");
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 128 * 1024,
    perMessageDeflate: false,
  });
  http.on("upgrade", (req, socket, head) => {
    if (
      req.url !== "/terminal" ||
      (req.headers.origin &&
        !options.allowedOrigins.includes(req.headers.origin))
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  });
  wss.on("connection", (socket) => {
    let authenticated = false,
      closed = false,
      queuedBytes = 0;
    let queue: Promise<unknown> = Promise.resolve();
    const subscriptions = new Map<string, () => void>();
    const reject = (code: number, reason: string) => {
      closed = true;
      socket.close(code, reason);
    };
    const timeout = setTimeout(
      () => reject(1008, "Authentication timeout"),
      5000,
    );
    const send = (value: unknown) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount > 4 * 1024 * 1024) {
        reject(1013, "Slow consumer; reconnect");
        return;
      }
      socket.send(JSON.stringify(value));
    };
    socket.on("error", () => {});
    socket.on("close", () => {
      closed = true;
      clearTimeout(timeout);
      for (const unsubscribe of subscriptions.values()) unsubscribe();
      subscriptions.clear();
    });
    socket.on("message", (raw, binary) => {
      if (closed) return;
      if (binary) {
        reject(1008, "JSON text frames required");
        return;
      }
      const length = Buffer.byteLength(raw.toString());
      queuedBytes += length;
      if (queuedBytes > 1024 * 1024) {
        reject(1008, "Request queue exceeded");
        return;
      }
      queue = queue
        .then(async () => {
          queuedBytes -= length;
          if (closed) return;
          let message: Record<string, unknown>;
          try {
            const value: unknown = JSON.parse(raw.toString());
            if (!value || typeof value !== "object" || Array.isArray(value))
              throw new Error();
            message = value as Record<string, unknown>;
          } catch {
            reject(1008, "Invalid JSON");
            return;
          }
          if (!authenticated) {
            const candidate =
                typeof message.token === "string"
                  ? Buffer.from(message.token)
                  : Buffer.alloc(0),
              expected = Buffer.from(options.token);
            if (
              message.type !== "auth" ||
              candidate.length !== expected.length ||
              !timingSafeEqual(candidate, expected)
            ) {
              reject(1008, "Authentication failed");
              return;
            }
            authenticated = true;
            clearTimeout(timeout);
            send({ type: "ready", version: 1 });
            return;
          }
          const requestId = message.requestId;
          if (typeof requestId !== "string" || requestId.length > 128) {
            reject(1008, "Invalid request id");
            return;
          }
          try {
            const params = message.params;
            if (!params || typeof params !== "object" || Array.isArray(params))
              throw new Error("Invalid params");
            const p = params as Record<string, unknown>;
            let result: unknown = null;
            if (message.method !== "list") validId(p.id);
            const id = p.id as string;
            switch (message.method) {
              case "create": {
                validSize(p.cols ?? 80, p.rows ?? 24);
                result = host.create({
                  id,
                  cols: Number(p.cols ?? 80),
                  rows: Number(p.rows ?? 24),
                });
                break;
              }
              case "list":
                result = host.list();
                break;
              case "attach": {
                subscriptions.get(id)?.();
                subscriptions.delete(id);
                const detach = await host.attach(id, send);
                if (closed) detach();
                else subscriptions.set(id, detach);
                break;
              }
              case "detach":
                subscriptions.get(id)?.();
                subscriptions.delete(id);
                break;
              case "write":
                if (
                  typeof p.data !== "string" ||
                  p.data.length > MAX_INPUT_LENGTH
                )
                  throw new Error("Invalid input");
                if (
                  p.encoding !== undefined &&
                  p.encoding !== "utf8" &&
                  p.encoding !== "binary"
                )
                  throw new Error("Invalid input encoding");
                host.write(id, p.data, p.encoding);
                break;
              case "resize":
                validSize(p.cols, p.rows);
                await host.resize(id, Number(p.cols), Number(p.rows));
                break;
              case "close":
                await host.close(id);
                subscriptions.get(id)?.();
                subscriptions.delete(id);
                break;
              default:
                throw new Error("Unknown method");
            }
            send({ type: "response", requestId, result });
          } catch (error) {
            send({
              type: "response",
              requestId,
              error: error instanceof Error ? error.message : "Request failed",
            });
          }
        })
        .catch(() => {
          reject(1011, "Internal error");
        });
    });
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port ?? 0, options.hostname ?? "127.0.0.1", () => {
      http.off("error", reject);
      resolve();
    });
  });
  const address = http.address();
  if (!address || typeof address === "string")
    throw new Error("Cannot resolve listening port");
  return {
    host,
    url: `ws://${options.hostname ?? "127.0.0.1"}:${address.port}/terminal`,
    port: address.port,
    async close() {
      for (const socket of wss.clients) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
      await host.dispose();
    },
  };
}
