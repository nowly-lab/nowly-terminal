import type { Socket } from "node:net";
export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 128 * 1024;
export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function readFrames(
  socket: Socket,
  maxBytes: number,
  receive: (frame: Record<string, unknown>) => void,
) {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    if (socket.destroyed) return;
    buffer += chunk;
    try {
      let index: number;
      while ((index = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (Buffer.byteLength(line) > maxBytes) throw Error("Frame too large");
        const frame: unknown = JSON.parse(line);
        if (!record(frame)) throw Error("Invalid frame");
        receive(frame);
        if (socket.destroyed) {
          buffer = "";
          return;
        }
      }
      if (Buffer.byteLength(buffer) > maxBytes) throw Error("Frame too large");
    } catch {
      buffer = "";
      socket.destroy();
    }
  });
}
export function sendFrame(
  socket: Socket,
  frame: unknown,
  limit = MAX_RESPONSE_BYTES,
) {
  if (socket.destroyed) return false;
  const text = JSON.stringify(frame) + "\n";
  if (
    Buffer.byteLength(text) > limit ||
    socket.writableLength + Buffer.byteLength(text) > MAX_RESPONSE_BYTES
  ) {
    socket.destroy();
    return false;
  }
  socket.write(text);
  return true;
}
