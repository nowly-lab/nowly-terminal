import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { SpawnOptions } from "../server/session.js";
import type { AgentEvent } from "../protocol.js";
import { CodexEvents, record } from "./events.js";
import { createCodexProxy } from "./proxy.js";
export interface CodexOptions {
  executable?: string;
  args?: string[];
  prompt?: string;
  sandbox?: "read-only" | "workspace-write";
  approvalPolicy?: "on-request" | "never";
  startupTimeoutMs?: number;
}
export const shellQuote = (value: string) =>
  `'${value.replaceAll("'", "'\\''")}'`;
export async function startCodexRuntime(
  options: CodexOptions,
  shell: SpawnOptions,
  sessionId: string,
  emit: (event: AgentEvent) => void,
) {
  if (process.platform === "win32")
    throw Error("Codex terminal profile currently requires POSIX Unix sockets");
  const dir = mkdtempSync(join(tmpdir(), "nt-cdx-"));
  chmodSync(dir, 0o700);
  const endpoint = join(dir, "s");
  const command = [options.executable ?? "codex", ...(options.args ?? [])];
  const invoke = (args: string[]) =>
    `exec ${[...command, ...args].map(shellQuote).join(" ")}`;
  const env = { ...shell.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // Preserve the protocol stdout on fd3 while startup scripts write to stderr.
  const backendCommand =
    invoke(["app-server", "--listen", "stdio://"]) + " >&3 3>&-";
  const shellCommand = [shell.shell, ...shell.args, "-c", backendCommand]
    .map(shellQuote)
    .join(" ");
  const child = spawn(
    "/bin/sh",
    ["-c", `exec 3>&1; exec ${shellCommand} 1>&2`],
    { cwd: shell.cwd, env, detached: true, stdio: "pipe" },
  );
  let exited = false,
    closing = false,
    proxy: Awaited<ReturnType<typeof createCodexProxy>> | undefined;
  const events = new CodexEvents(sessionId, "");
  const rootRequests = new Set<string | number>();
  let failed = false;
  const fail = (status = "backend-exited") => {
    if (!closing && !failed) {
      failed = true;
      for (const event of events.error(status)) emit(event);
      if (proxy) void dispose().catch(() => {});
    }
  };
  child.stderr.on("data", () => {}); // Drain diagnostics; never forward raw user configuration to the renderer.
  const ended = new Promise<void>((resolve) => {
    child.once("error", () => {
      exited = true;
      resolve();
      fail();
    });
    child.once("exit", () => {
      exited = true;
      resolve();
      fail();
    });
  });
  let stopping: Promise<void> | undefined;
  const dispose = () =>
    (stopping ??= (async () => {
      closing = true;
      clearTimeout(startupTimer);
      await proxy?.dispose();
      let signalError: Error | undefined;
      const signal = (sig: NodeJS.Signals) => {
        if (child.pid)
          try {
            process.kill(-child.pid, sig);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ESRCH")
              signalError = e as Error;
          }
      };
      signal("SIGTERM");
      if (!exited) await Promise.race([ended, delay(750)]);
      signal("SIGKILL");
      if (!exited) await Promise.race([ended, delay(1500)]);
      if (!exited)
        throw signalError ?? Error("Codex process did not terminate");
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      rmSync(dir, { recursive: true, force: true });
    })());
  const startupTimer = setTimeout(() => {
    fail("startup-timeout");
    void dispose().catch(() => {});
  }, options.startupTimeoutMs ?? 30000);
  try {
    proxy = await createCodexProxy(
      endpoint,
      child,
      (frame) => {
        clearTimeout(startupTimer);
        if (rootRequests.delete(frame.id)) {
          const thread = record(record(frame.result).thread),
            id = thread.id;
          if (
            typeof id === "string" &&
            /^[\w-]{1,128}$/.test(id) &&
            thread.threadSource !== "system"
          ) {
            // Only a response to this TUI's own start/resume/fork proves root ownership.
            // Backend-created internal threads can have the same source as the TUI.
            events.activateRoot(id);
            for (const event of events.accept("thread/started", { thread }))
              emit(event);
          }
        }
        if (events.rootThreadId) {
          clearTimeout(startupTimer);
          if (typeof frame.method === "string" && frame.id === undefined)
            for (const event of events.accept(frame.method, frame.params))
              emit(event);
        }
      },
      fail,
      (frame) => {
        if (
          ["thread/start", "thread/resume", "thread/fork"].includes(
            frame.method,
          ) &&
          record(frame.params).threadSource !== "system" &&
          (typeof frame.id === "string" || typeof frame.id === "number")
        ) {
          if (rootRequests.size >= 128)
            throw Error("Too many pending thread requests");
          rootRequests.add(frame.id);
        }
      },
    );
    chmodSync(endpoint, 0o600);
    if (exited || failed)
      throw Error("Codex failed to start; check executable and configuration");
    const cliArgs = [
      "--remote",
      `unix://${endpoint}`,
      ...(options.sandbox ? ["--sandbox", options.sandbox] : []),
      ...(options.approvalPolicy
        ? ["--ask-for-approval", options.approvalPolicy]
        : []),
      ...(options.prompt ? [options.prompt] : []),
    ];
    return {
      pid: child.pid!,
      endpoint,
      ptyArgs: [...shell.args, "-c", invoke(cliArgs)],
      get events() {
        return events;
      },
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
export type CodexRuntime = Awaited<ReturnType<typeof startCodexRuntime>>;
