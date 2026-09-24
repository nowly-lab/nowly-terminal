import { afterEach, expect, test } from "vitest";
import WebSocket from "ws";
import { createTerminalServer } from "../src/server/websocket.js";
import { WebSocketTransport } from "../src/client.js";
import type { TerminalEvent } from "../src/protocol.js";
const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function setup() {
  const server = await createTerminalServer({
    token: "test-token",
    allowedOrigins: ["http://localhost:5173"],
    hostOptions: { shell: "/bin/sh", args: [] },
  });
  cleanup.push(() => server.close());
  return server;
}
test("authenticated transport reattaches with same PID and preserved history", async () => {
  const server = await setup();
  const client = new WebSocketTransport({
    url: server.url,
    token: "test-token",
  });
  cleanup.push(() => client.dispose());
  await client.ready();
  const first = await client.request("create", { id: "wire" });
  const events: TerminalEvent[] = [];
  client.subscribe((e) => events.push(e));
  await client.request("attach", { id: "wire" });
  await client.request("write", {
    id: "wire",
    data: "printf 'WIRE_%s\\n' OK\r",
  });
  await expect
    .poll(() =>
      events
        .filter((e) => e.type === "data")
        .map((e) => e.data)
        .join(""),
    )
    .toContain("WIRE_OK");
  client.reconnect();
  await client.ready();
  await client.request("attach", { id: "wire" });
  expect((await client.request("list", {}))[0].pid).toBe(first.pid);
  expect(
    events.filter((e) => e.type === "snapshot").at(-1)?.snapshot.ansi,
  ).toContain("WIRE_OK");
  await expect(
    client.request("resize", { id: "wire", cols: -2, rows: 24 }),
  ).rejects.toThrow();
  await client.request("close", { id: "wire" });
  expect(await client.request("list", {})).toEqual([]);
});
test("rejects invalid authentication and origin without spawning", async () => {
  const server = await setup();
  const socket = new WebSocket(server.url);
  await new Promise<void>((resolve) => socket.once("open", resolve));
  const closed = new Promise<number>((resolve) =>
    socket.once("close", resolve),
  );
  socket.send(JSON.stringify({ type: "auth", token: "wrong" }));
  expect(await closed).toBe(1008);
  const denied = new WebSocket(server.url, { origin: "https://evil.example" });
  denied.on("error", () => {});
  const status = await new Promise<number>((resolve) =>
    denied.on("unexpected-response", (_req, res) => {
      resolve(res.statusCode!);
      res.resume();
    }),
  );
  expect(status).toBe(403);
  denied.terminate();
  expect(server.host.list()).toEqual([]);
});
test("invalid method receives structured error, no unhandled exception", async () => {
  const server = await setup();
  const client = new WebSocketTransport({
    url: server.url,
    token: "test-token",
  });
  cleanup.push(() => client.dispose());
  await client.ready();
  await expect(client.request("create", { id: "../bad" })).rejects.toThrow(
    "Invalid session id",
  );
  expect(server.host.list()).toEqual([]);
});
test("rejecting one frame fences already queued authentication and commands", async () => {
  const server = await setup();
  const socket = new WebSocket(server.url);
  await new Promise<void>((r) => socket.once("open", r));
  const closed = new Promise<void>((r) => socket.once("close", () => r()));
  socket.send("not-json");
  socket.send(JSON.stringify({ type: "auth", token: "test-token" }));
  socket.send(
    JSON.stringify({
      requestId: "1",
      method: "create",
      params: { id: "forbidden" },
    }),
  );
  await closed;
  expect(server.host.list()).toEqual([]);
});
