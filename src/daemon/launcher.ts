import { fork } from "node:child_process";
import {
  openSync,
  writeFileSync,
  closeSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { HostOptions } from "../server/host.js";
import { DaemonClient } from "./client.js";
import {
  configurationHash,
  processAlive,
  readDescriptor,
  runtimeDirectory,
} from "./metadata.js";
export interface DaemonOptions {
  runtimeDir: string;
  hostOptions?: HostOptions;
  executablePath?: string;
  entryPath?: string;
  startupTimeoutMs?: number;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function reuse(runtime: string, hash: string) {
  const descriptor = readDescriptor(runtime);
  if (!descriptor) return;
  const client = new DaemonClient(descriptor);
  try {
    await client.ready();
  } catch (error) {
    client.dispose();
    if (processAlive(descriptor.pid))
      throw Error(
        "Existing terminal daemon is alive but unreachable; do not replace it. " +
          (error as Error).message,
      );
    return;
  }
  if (descriptor.configHash !== hash) {
    client.dispose();
    throw Error(
      "Existing daemon configuration differs. Stop its terminals explicitly or use a different runtime directory.",
    );
  }
  return client;
}
export async function ensureTerminalDaemon(
  options: DaemonOptions,
): Promise<DaemonClient> {
  const runtime = runtimeDirectory(options.runtimeDir);
  const hostOptions: HostOptions = {
    ...options.hostOptions,
    shell:
      options.hostOptions?.shell ??
      (process.platform === "win32"
        ? (process.env.COMSPEC ?? "cmd.exe")
        : (process.env.SHELL ?? "/bin/sh")),
    cwd: resolve(options.hostOptions?.cwd ?? homedir()),
  };
  const hash = configurationHash(hostOptions);
  const existing = await reuse(runtime, hash);
  if (existing) return existing;
  const lock = join(runtime, "launch.lock");
  const owner = JSON.stringify({ pid: process.pid, instanceId: randomUUID() });
  const deadline = Date.now() + (options.startupTimeoutMs ?? 10000);
  let locked = false;
  while (Date.now() < deadline) {
    try {
      const fd = openSync(lock, "wx", 0o600);
      try {
        writeFileSync(fd, owner);
      } finally {
        closeSync(fd);
      }
      locked = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await sleep(30);
      const ready = await reuse(runtime, hash);
      if (ready) return ready;
    }
  }
  if (!locked)
    throw Error(
      `Timed out waiting for ${lock}. If a launcher crashed, verify no launcher is active and move this lock aside before retrying.`,
    );
  try {
    const ready = await reuse(runtime, hash);
    if (ready) return ready;
    await launch(
      options,
      runtime,
      hostOptions,
      Math.max(1, deadline - Date.now()),
    );
    const client = await reuse(runtime, hash);
    if (!client) throw Error("Daemon exited during startup");
    return client;
  } finally {
    try {
      if (readFileSync(lock, "utf8") === owner) unlinkSync(lock);
    } catch {}
  }
}
function launch(
  options: DaemonOptions,
  runtimeDir: string,
  hostOptions: HostOptions,
  timeoutMs: number,
) {
  return new Promise<void>((resolve, reject) => {
    const child = fork(
      options.entryPath ??
        fileURLToPath(new URL("./entry.js", import.meta.url)),
      [],
      {
        execPath: options.executablePath ?? process.execPath,
        execArgv: [],
        cwd: runtimeDir,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      },
    );
    let settled = false;
    let errors = "";
    child.stderr?.on("data", (chunk) => {
      errors = (errors + chunk.toString()).slice(-4096);
    });
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", exited);
      child.stderr?.destroy();
      if (error) {
        child.kill();
        reject(error);
      } else {
        child.unref();
        resolve();
      }
    };
    const exited = () =>
      finish(
        Error("Terminal daemon startup failed" + (errors ? ": " + errors : "")),
      );
    const timer = setTimeout(
      () => finish(Error("Terminal daemon startup timed out")),
      timeoutMs,
    );
    child.once("error", finish);
    child.once("exit", exited);
    child.on("message", (message: any) => {
      if (message?.type === "ready") finish();
      else if (message?.type === "error")
        finish(Error(String(message.message)));
    });
    child.send({ runtimeDir, hostOptions }, (error) => {
      if (error) finish(error);
    });
  });
}
