import {
  startCodexRuntime,
  type CodexOptions,
  type CodexRuntime,
} from "../codex/runtime.js";
import { shellProfileArgs, type ShellProfile } from "./shell-profile.js";
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
  codex?: CodexOptions;
  shell?: string;
  shellProfile?: ShellProfile;
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
  private pending = new Map<
    string,
    Promise<import("../protocol.js").SessionInfo>
  >();
  private spawn: SpawnOptions;
  private limit: number;
  constructor(private options: HostOptions = {}) {
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
      args:
        options.args ?? shellProfileArgs(shell, options.shellProfile ?? "user"),
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
  async create(
    options: CreateSession,
  ): Promise<import("../protocol.js").SessionInfo> {
    if (this.disposed) throw new Error("Host disposed");
    validId(options.id);
    const cols = options.cols ?? 80,
      rows = options.rows ?? 24;
    validSize(cols, rows);
    if (this.closing.has(options.id)) throw Error("Session is closing");
    const existing = this.sessions.get(options.id);
    if (existing) return existing.info();
    const pending = this.pending.get(options.id);
    if (pending) return pending;
    if (
      new Set([...this.sessions.keys(), ...this.pending.keys()]).size >=
      this.limit
    )
      throw Error("Session limit reached");
    const create = async () => {
      let runtime: CodexRuntime | undefined, session: Session | undefined;
      try {
        if (this.options.codex)
          runtime = await startCodexRuntime(
            this.options.codex,
            this.spawn,
            options.id,
            (event) => session?.agentEvent(event),
          );
        if (this.disposed || this.closing.has(options.id))
          throw Error("Host disposed or session closing");
        session = new Session(
          options.id,
          cols,
          rows,
          runtime ? { ...this.spawn, args: runtime.ptyArgs } : this.spawn,
          runtime,
        );
        this.sessions.set(options.id, session);
        return session.info();
      } catch (error) {
        await runtime?.dispose();
        throw error;
      }
    };
    const result = create();
    this.pending.set(options.id, result);
    try {
      return await result;
    } finally {
      this.pending.delete(options.id);
    }
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
    this.closing.add(id);
    try {
      await this.pending.get(id)?.catch(() => {});
      const session = this.sessions.get(id);
      if (!session) return;
      await session.dispose();
      this.sessions.delete(id);
    } finally {
      this.closing.delete(id);
    }
  }
  async dispose() {
    this.disposed = true;
    await Promise.allSettled([...this.pending.values()]);
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
  }
}
