import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { record } from "./events.js";
/** One TUI owns the RPC session. Transparent forwarding preserves approval UI. */
export async function createCodexProxy(
  endpoint: string,
  child: ChildProcessWithoutNullStreams,
  onFrame: (frame: Record<string, any>) => void,
  onError: (status: string) => void,
  onRequest: (frame: Record<string, any>) => void = () => {},
) {
  const http = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({
    server: http,
    maxPayload: 8 * 1024 * 1024,
    perMessageDeflate: false,
  });
  let client: WebSocket | undefined,
    closed = false,
    failed = false;
  let parts: Buffer[] = [],
    pendingBytes = 0;
  const fail = (status: string) => {
    if (closed || failed) return;
    failed = true;
    onError(status);
    client?.terminate();
  };
  wss.on("connection", (socket) => {
    if (client || closed || failed) {
      socket.close(1008, "Only one Codex TUI is allowed");
      return;
    }
    client = socket;
    socket.on("error", () => fail("client-error"));
    socket.on("message", (bytes, binary) => {
      if (
        binary ||
        child.stdin.destroyed ||
        child.stdin.writableLength > 1024 * 1024
      ) {
        fail("client-backpressure-or-binary");
        return;
      }
      try {
        if (failed) return;
        const frame = record(JSON.parse(bytes.toString()));
        if (!frame.method && frame.id === undefined) throw Error();
        onRequest(frame);
        child.stdin.write(JSON.stringify(frame) + "\n");
      } catch {
        fail("invalid-client-frame");
      }
    });
    socket.on("close", (code) => {
      if (!closed && code !== 1000 && code !== 1001)
        onError("client-disconnected");
    });
  });
  child.stdout.on("data", (chunk: Buffer) => {
    if (closed || failed) return;
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const part = chunk.subarray(offset, newline < 0 ? chunk.length : newline);
      pendingBytes += part.length;
      if (pendingBytes > 64 * 1024 * 1024) {
        parts = [];
        pendingBytes = 0;
        fail("backend-frame-too-large");
        return;
      }
      parts.push(part);
      if (newline < 0) return;
      const line = Buffer.concat(parts, pendingBytes).toString("utf8");
      parts = [];
      pendingBytes = 0;
      offset = newline + 1;
      if (!line.trim()) continue;
      try {
        const frame = record(JSON.parse(line));
        onFrame(frame);
        if (client?.readyState === WebSocket.OPEN) {
          if (client.bufferedAmount > 64 * 1024 * 1024) {
            fail("slow-tui");
            return;
          }
          client.send(line);
        }
      } catch {
        fail("invalid-backend-frame");
        return;
      }
    }
  });
  child.stdin.on("error", () => fail("backend-input-closed"));
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(endpoint, () => {
      http.removeListener("error", reject);
      resolve();
    });
  });
  http.on("error", () => fail("listener-error"));
  return {
    async dispose() {
      closed = true;
      for (const socket of wss.clients) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
