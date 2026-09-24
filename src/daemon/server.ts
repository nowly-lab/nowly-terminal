import { createServer, type Socket } from "node:net";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmodSync } from "node:fs";
import { TerminalHost, type HostOptions } from "../server/host.js";
import { validId, type CreateSession } from "../protocol.js";
import {
  PROTOCOL_VERSION,
  configurationHash,
  endpointFor,
  publishDescriptor,
  removeOwnDescriptor,
  runtimeDirectory,
  type Descriptor,
} from "./metadata.js";
import { MAX_REQUEST_BYTES, readFrames, record, sendFrame } from "./wire.js";
export async function startDaemon(runtimeDir: string, options: HostOptions) {
  const runtime = runtimeDirectory(runtimeDir);
  const instanceId = randomUUID();
  const descriptor: Descriptor = {
    version: PROTOCOL_VERSION,
    pid: process.pid,
    instanceId,
    token: randomBytes(32).toString("hex"),
    endpoint: endpointFor(runtime, instanceId),
    configHash: configurationHash(options),
  };
  const host = new TerminalHost(options);
  const sockets = new Set<Socket>();
  let closing = false,
    queued = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let stopped: Promise<void> | undefined;
  const server = createServer((socket) => {
    if (closing || sockets.size >= 16) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    let authenticated = false,
      active = true,
      pending = 0;
    const subscriptions = new Map<string, () => void>();
    const timeout = setTimeout(() => socket.destroy(), 3000);
    const reset = () => {
      active = false;
      clearTimeout(timeout);
      for (const off of subscriptions.values()) off();
      subscriptions.clear();
      sockets.delete(socket);
    };
    socket.on("error", () => {});
    socket.once("close", reset);
    readFrames(socket, MAX_REQUEST_BYTES, (frame) => {
      if (!active || closing) return socket.destroy();
      if (!authenticated) {
        const token =
          typeof frame.token === "string"
            ? Buffer.from(frame.token)
            : Buffer.alloc(0);
        const expected = Buffer.from(descriptor.token);
        if (
          frame.type !== "auth" ||
          frame.version !== PROTOCOL_VERSION ||
          token.length !== expected.length ||
          !timingSafeEqual(token, expected)
        ) {
          active = false;
          socket.destroy();
          return;
        }
        authenticated = true;
        clearTimeout(timeout);
        sendFrame(socket, {
          type: "ready",
          version: PROTOCOL_VERSION,
          instanceId,
        });
        return;
      }
      if (
        !Number.isSafeInteger(frame.requestId) ||
        Number(frame.requestId) < 1 ||
        typeof frame.method !== "string" ||
        !record(frame.params) ||
        pending >= 64 ||
        queued >= 128
      ) {
        active = false;
        socket.destroy();
        return;
      }
      pending++;
      queued++;
      queue = queue
        .then(async () => {
          if (!active || socket.destroyed || closing) return;
          const { method, params, requestId } = frame as {
            method: string;
            params: Record<string, unknown>;
            requestId: number;
          };
          try {
            let result: unknown = null;
            if (
              ![
                "create",
                "list",
                "attach",
                "detach",
                "write",
                "resize",
                "close",
                "shutdown",
              ].includes(method)
            )
              throw Error("Unsupported terminal method");
            if (method !== "list" && method !== "shutdown") validId(params.id);
            const id = params.id as string;
            switch (method) {
              case "create":
                result = host.create({
                  id,
                  cols: params.cols,
                  rows: params.rows,
                } as CreateSession);
                break;
              case "list":
                result = host.list();
                break;
              case "attach": {
                subscriptions.get(id)?.();
                subscriptions.delete(id);
                const off = await host.attach(id, (event) => {
                  if (active && !socket.destroyed) sendFrame(socket, event);
                });
                if (!active || socket.destroyed) off();
                else subscriptions.set(id, off);
                break;
              }
              case "detach":
                subscriptions.get(id)?.();
                subscriptions.delete(id);
                break;
              case "write":
                host.write(
                  id,
                  params.data as string,
                  params.encoding as "utf8" | "binary" | undefined,
                );
                break;
              case "resize":
                await host.resize(
                  id,
                  params.cols as number,
                  params.rows as number,
                );
                break;
              case "close":
                await host.close(id);
                subscriptions.get(id)?.();
                subscriptions.delete(id);
                break;
              case "shutdown": {
                closing = true;
                await host.dispose();
                sendFrame(socket, {
                  type: "response",
                  requestId,
                  result: null,
                });
                socket.end();
                setImmediate(() => void stop());
                return;
              }
            }
            if (active)
              sendFrame(socket, { type: "response", requestId, result });
          } catch (error) {
            if (active)
              sendFrame(socket, {
                type: "response",
                requestId,
                error:
                  error instanceof Error
                    ? error.message
                    : "Terminal request failed",
              });
          }
        })
        .finally(() => {
          pending--;
          queued--;
        });
    });
  });
  const stop = () =>
    (stopped ??= (async () => {
      closing = true;
      for (const socket of sockets) socket.destroy();
      await queue.catch(() => {});
      await host.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      removeOwnDescriptor(runtime, instanceId);
    })());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(descriptor.endpoint, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  try {
    if (process.platform !== "win32") chmodSync(descriptor.endpoint, 0o600);
    publishDescriptor(runtime, descriptor);
  } catch (error) {
    await stop();
    throw error;
  }
  server.on("error", () => void stop());
  return { descriptor, stop };
}
