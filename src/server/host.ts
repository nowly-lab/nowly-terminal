import { homedir } from "node:os";
import {
  MAX_INPUT_LENGTH,
  validId,
  validSize,
  type CreateSession,
  type TerminalEvent,
} from "../protocol.js";
import { Session, type SpawnOptions } from "./session.js";
export interface HostOptions {
  shell?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  scrollback?: number;
  maxSessions?: number;
}
export class TerminalHost {
  private sessions = new Map<string, Session>();
  private closing = new Set<string>();
  private disposed = false;
  private spawn: SpawnOptions;
  private limit: number;
  constructor(options: HostOptions = {}) {
    this.limit = options.maxSessions ?? 32;
    const shell =
      options.shell ??
      (process.platform === "win32"
        ? (process.env.COMSPEC ?? "cmd.exe")
        : (process.env.SHELL ?? "/bin/sh"));
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env))
      if (value !== undefined) env[key] = value;
    this.spawn = {
      shell,
      args: options.args ?? [],
      cwd: options.cwd ?? homedir(),
      env: {
        ...env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        ...options.env,
      },
      scrollback: options.scrollback ?? 5000,
    };
  }
  create(options: CreateSession) {
    if (this.disposed) throw new Error("Host disposed");
    validId(options.id);
    const cols = options.cols ?? 80,
      rows = options.rows ?? 24;
    validSize(cols, rows);
    if (this.closing.has(options.id)) throw new Error("Session is closing");
    const existing = this.sessions.get(options.id);
    if (existing) return existing.info();
    if (this.sessions.size >= this.limit)
      throw new Error("Session limit reached");
    const session = new Session(options.id, cols, rows, this.spawn);
    this.sessions.set(options.id, session);
    return session.info();
  }
  private get(id: string) {
    validId(id);
    const session = this.sessions.get(id);
    if (!session || this.closing.has(id)) throw new Error("Unknown session");
    return session;
  }
  list() {
    return [...this.sessions.values()].map((s) => s.info());
  }
  async snapshot(id: string) {
    return this.get(id).snapshot();
  }
  async attach(id: string, listener: (event: TerminalEvent) => void) {
    return this.get(id).attach(listener);
  }
  write(id: string, data: string, encoding: "utf8" | "binary" = "utf8") {
    if (typeof data !== "string" || data.length > MAX_INPUT_LENGTH)
      throw new Error("Input too large or invalid");
    if (encoding !== "utf8" && encoding !== "binary")
      throw new Error("Invalid input encoding");
    if (encoding === "binary" && /[^\x00-\xff]/.test(data))
      throw new Error("Invalid binary input");
    this.get(id).write(
      encoding === "binary" ? Buffer.from(data, "latin1") : data,
    );
  }
  async resize(id: string, cols: number, rows: number) {
    validSize(cols, rows);
    await this.get(id).resize(cols, rows);
  }
  async close(id: string) {
    validId(id);
    const session = this.sessions.get(id);
    if (!session) return;
    this.closing.add(id);
    try {
      await session.dispose();
      this.sessions.delete(id);
    } finally {
      this.closing.delete(id);
    }
  }
  async dispose() {
    this.disposed = true;
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
  }
}
