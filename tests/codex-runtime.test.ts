import { expect, test } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startCodexRuntime } from "../src/codex/runtime.js";
import { CodexRpc } from "./helpers/codex-rpc.js";
const executable = process.execPath,
  args = [resolve("tests/fixtures/codex-server.mjs")];
const shell = {
  shell: "/bin/sh",
  args: [],
  cwd: process.cwd(),
  env: process.env as Record<string, string>,
  scrollback: 100,
};
test("fragmented RPC initializes, creates thread and disposes the owned process", async () => {
  const received: any[] = [];
  const runtime = await startCodexRuntime(
    { executable, args },
    shell,
    "pane",
    (e) => received.push(e),
  );
  try {
    const rpc = await CodexRpc.connect(runtime.endpoint);
    await rpc.request("initialize", {});
    expect((await rpc.request("big", {})).blob).toHaveLength(9 * 1024 * 1024);
    await rpc.request("thread/start", {});
    expect(runtime.ptyArgs.join(" ")).toContain("--remote");
    await expect
      .poll(() => received.some((e) => e.kind === "task.started"))
      .toBe(true);
  } finally {
    await runtime.dispose();
  }
  expect(() => process.kill(runtime.pid, 0)).toThrow();
});
for (const mode of ["error", "exit", "oversize", "timeout"])
  test(`failed startup ${mode} cleans up owned process`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-test-"));
    const pidfile = join(dir, "pid");
    try {
      const runtime = await startCodexRuntime(
        { executable, args, startupTimeoutMs: 350 },
        {
          ...shell,
          env: { ...shell.env, FAKE_MODE: mode, FAKE_PID_FILE: pidfile },
        },
        "p",
        () => {},
      );
      try {
        const rpc = await CodexRpc.connect(runtime.endpoint, 200);
        await expect(rpc.request("initialize", {})).rejects.toThrow();
        rpc.dispose();
      } finally {
        await runtime.dispose();
      }
      const pid = Number(readFileSync(pidfile, "utf8"));
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

test("host deduplicates Codex startup, replays events and closes sidecar with PTY", async () => {
  const { TerminalHost } = await import("../src/server/host.js");
  const host = new TerminalHost({
    shell: "/bin/sh",
    args: [],
    codex: { executable, args },
  });
  try {
    const [a, b] = await Promise.all([
      host.create({ id: "codex" }),
      host.create({ id: "codex" }),
    ]);
    expect(a.pid).toBe(b.pid);
    await expect
      .poll(async () => (await host.snapshot("codex")).ansi)
      .toContain("CODEX_TUI_FIXTURE");
    await expect
      .poll(async () =>
        (await host.snapshot("codex")).agentEvents?.some(
          (e) => e.kind === "task.started",
        ),
      )
      .toBe(true);
    const before = (await host.snapshot("codex")).agentEvents;
    const captured: any[] = [];
    const off = await host.attach("codex", (e) => captured.push(e));
    off();
    expect(captured[0].snapshot.agentEvents).toEqual(before);
  } finally {
    await host.dispose();
  }
});
test("dispose during pending Codex creation rejects create and reaps its sidecar", async () => {
  const { TerminalHost } = await import("../src/server/host.js");
  const dir = mkdtempSync(join(tmpdir(), "codex-host-"));
  const pidfile = join(dir, "pid");
  const host = new TerminalHost({
    shell: "/bin/sh",
    args: [],
    env: { FAKE_PID_FILE: pidfile },
    codex: { executable, args },
  });
  try {
    const creating = host.create({ id: "race" });
    const checked = expect(creating).rejects.toThrow("disposed");
    await host.dispose();
    await checked;
    expect(() =>
      process.kill(Number(readFileSync(pidfile, "utf8")), 0),
    ).toThrow();
    expect(host.list()).toEqual([]);
  } finally {
    await host.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("login shell output cannot corrupt Codex protocol stdout", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-profile-"));
  const rc = join(dir, "rc");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(rc, "printf '\\033]1337;CurrentDir=profile\\007'\n");
  let runtime: Awaited<ReturnType<typeof startCodexRuntime>> | undefined;
  try {
    runtime = await startCodexRuntime(
      { executable, args },
      { ...shell, shell: "/bin/bash", args: ["--rcfile", rc, "-i"] },
      "p",
      () => {},
    );
    const rpc = await CodexRpc.connect(runtime.endpoint, 500);
    try {
      await expect(rpc.request("initialize", {})).resolves.toEqual({});
    } finally {
      rpc.dispose();
    }
  } finally {
    await runtime?.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("backend death closes the TUI connection rather than leaving a frozen terminal", async () => {
  const runtime = await startCodexRuntime(
    { executable, args },
    shell,
    "pane",
    () => {},
  );
  const { default: WebSocket } = await import("ws");
  const socket = new WebSocket(`ws+unix://${runtime.endpoint}:/`);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    process.kill(runtime.pid, "SIGKILL");
    await expect
      .poll(() => socket.readyState, { timeout: 600 })
      .toBe(WebSocket.CLOSED);
  } finally {
    socket.terminate();
    await runtime.dispose();
  }
});
