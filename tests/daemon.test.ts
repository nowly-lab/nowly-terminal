import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connect } from "node:net";
import {
  ensureTerminalDaemon,
  connectTerminalDaemon,
  type DaemonClient,
} from "../src/daemon/index.js";
const dirs: string[] = [];
const clients: DaemonClient[] = [];
function options() {
  const runtimeDir = mkdtempSync(join(tmpdir(), "nt-daemon-"));
  dirs.push(runtimeDir);
  return {
    runtimeDir,
    entryPath: resolve("dist/daemon/entry.js"),
    hostOptions: {
      shell: "/bin/zsh",
      shellProfile: "clean" as const,
      cwd: runtimeDir,
      env: { PS1: "DAEMON_READY> " },
    },
  };
}
async function start(opts = options()) {
  const client = await ensureTerminalDaemon(opts);
  clients.push(client);
  return client;
}
async function screen(client: DaemonClient, id: string) {
  let text = "";
  const off = client.subscribe((e) => {
    if (e.type === "snapshot" && e.sessionId === id) text = e.snapshot.ansi;
  });
  try {
    await client.request("attach", { id });
    return text;
  } finally {
    off();
  }
}
afterEach(async () => {
  for (const client of clients.splice(0)) {
    try {
      if (client.status === "ready") await client.shutdown();
    } catch {}
    client.dispose();
  }
  for (const dir of dirs.splice(0)) {
    try {
      const c = await connectTerminalDaemon(dir);
      await c.shutdown();
      c.dispose();
    } catch {}
    rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
test("detached daemon preserves shell PID, variables and offline output across clients", async () => {
  const opts = options();
  const first = await start(opts);
  const info = first.info();
  expect(info.pid).not.toBe(process.pid);
  const shell = await first.request("create", { id: "persistent" });
  await expect.poll(() => screen(first, shell.id)).toContain("DAEMON_READY>");
  await first.request("write", {
    id: shell.id,
    data: "export KEEP_VALUE=kept; (sleep .2; printf 'OFFLINE_%s\\n' OUTPUT) &\r",
  });
  first.dispose();
  expect(() => process.kill(shell.pid, 0)).not.toThrow();
  const second = await start(opts);
  expect(second.info().pid).toBe(info.pid);
  expect((await second.request("list", {}))[0].pid).toBe(shell.pid);
  await expect.poll(() => screen(second, shell.id)).toContain("OFFLINE_OUTPUT");
  await second.request("write", {
    id: shell.id,
    data: "printf 'VALUE_%s\\n' \"$KEEP_VALUE\"\r",
  });
  await expect.poll(() => screen(second, shell.id)).toContain("VALUE_kept");
  await second.shutdown();
  await expect
    .poll(() => {
      try {
        process.kill(shell.pid, 0);
        return false;
      } catch {
        return true;
      }
    })
    .toBe(true);
});
test("concurrent launchers reuse one daemon and config mismatch leaves it intact", async () => {
  const opts = options();
  const connected = await Promise.all([start(opts), start(opts), start(opts)]);
  expect(new Set(connected.map((c) => c.info().pid)).size).toBe(1);
  await expect(
    ensureTerminalDaemon({
      ...opts,
      hostOptions: { ...opts.hostOptions, cwd: tmpdir() },
    }),
  ).rejects.toThrow("configuration");
  expect(connected[0].status).toBe("ready");
});
test("wrong token and malformed frames never create a shell", async () => {
  const opts = options();
  const client = await start(opts);
  const meta = JSON.parse(
    readFileSync(join(opts.runtimeDir, "daemon.json"), "utf8"),
  );
  const socket = connect(meta.endpoint);
  const closed = new Promise<void>((resolve) =>
    socket.on("close", () => resolve()),
  );
  socket.on("error", () => {});
  socket.write(
    JSON.stringify({ type: "auth", version: 1, token: "wrong" }) +
      "\n" +
      JSON.stringify({
        requestId: 1,
        method: "create",
        params: { id: "unauthorized" },
      }) +
      "\n",
  );
  await closed;
  const bad = connect(meta.endpoint);
  const rejected = new Promise<void>((resolve) =>
    bad.on("close", () => resolve()),
  );
  bad.on("error", () => {});
  bad.write("not-json\n");
  await rejected;
  expect(await client.request("list", {})).toEqual([]);
});
test("dead daemon can be replaced; stale launch lock is not blindly removed", async () => {
  const opts = options();
  const client = await start(opts);
  const old = client.info();
  process.kill(old.pid, "SIGKILL");
  await expect.poll(() => client.status).toBe("disconnected");
  const next = await start(opts);
  expect(next.info().pid).not.toBe(old.pid);
  expect(await next.request("list", {})).toEqual([]);
  const locked = options();
  writeFileSync(join(locked.runtimeDir, "launch.lock"), "unknown owner", {
    mode: 0o600,
  });
  await expect(
    ensureTerminalDaemon({ ...locked, startupTimeoutMs: 150 }),
  ).rejects.toThrow("launch.lock");
});
