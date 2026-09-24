import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  lstatSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { HostOptions } from "../server/host.js";
export const PROTOCOL_VERSION = 1;
export interface DaemonInfo {
  version: number;
  pid: number;
  instanceId: string;
}
export interface Descriptor extends DaemonInfo {
  token: string;
  endpoint: string;
  configHash: string;
}
export function privateDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (process.platform !== "win32" &&
      (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0))
  )
    throw Error(
      "Daemon runtime directory must be private (0700) and owned by this user",
    );
  return realpathSync(path);
}
export function runtimeDirectory(path: string) {
  return privateDirectory(resolve(path));
}
export function endpointFor(runtime: string, instance: string) {
  const hash = createHash("sha256").update(runtime).digest("hex").slice(0, 20);
  if (process.platform === "win32")
    return `\\\\.\\pipe\\nowly-terminal-${hash}-${instance}`;
  const directory = privateDirectory(
    join(realpathSync(tmpdir()), `nt-${process.getuid?.() ?? "user"}-${hash}`),
  );
  return join(directory, instance.slice(0, 12) + ".sock");
}
export function descriptorPath(runtime: string) {
  return join(runtime, "daemon.json");
}
export function readDescriptor(runtime: string): Descriptor | undefined {
  const file = descriptorPath(runtime);
  let stat;
  try {
    stat = lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > 8192 ||
    (process.platform !== "win32" &&
      (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0))
  )
    throw Error("Unsafe daemon descriptor");
  const value = JSON.parse(readFileSync(file, "utf8")) as Descriptor;
  if (
    value.version !== PROTOCOL_VERSION ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    typeof value.instanceId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(value.instanceId) ||
    typeof value.token !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.token) ||
    typeof value.configHash !== "string" ||
    value.endpoint !== endpointFor(runtime, value.instanceId)
  )
    throw Error("Invalid or incompatible daemon descriptor");
  return value;
}
export function publishDescriptor(runtime: string, value: Descriptor) {
  const temp = join(runtime, `descriptor-${randomUUID()}.tmp`);
  writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
  renameSync(temp, descriptorPath(runtime));
}
export function removeOwnDescriptor(runtime: string, instance: string) {
  try {
    if (readDescriptor(runtime)?.instanceId === instance)
      unlinkSync(descriptorPath(runtime));
  } catch {
    /* Never unlink an unverified replacement. */
  }
}
export function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stable(v)]),
    );
  return value;
}
export function configurationHash(options: HostOptions) {
  return createHash("sha256")
    .update(JSON.stringify(stable(options)))
    .digest("hex");
}
