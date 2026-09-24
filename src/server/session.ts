import type { CodexRuntime } from "../codex/runtime.js";
import type { AgentEvent } from "../protocol.js";
import { CharsetState } from "./charset-state.js";
import {
  serializeWithAbsoluteCursor,
  readSavedCursorRegister,
} from "../vendor/orca/terminal-serialize-absolute-cursor.js";
import * as pty from "node-pty";
import headless from "@xterm/headless";
import serialize from "@xterm/addon-serialize";
import unicode from "@xterm/addon-unicode11";
import type { SessionInfo, Snapshot, TerminalEvent } from "../protocol.js";
import { advancePartialEscapeTail } from "../vendor/orca/terminal-partial-escape-tail.js";
export interface SpawnOptions {
  shell: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  scrollback: number;
}
export class Session {
  readonly process: pty.IPty;
  private terminal: headless.Terminal;
  private serializer: serialize.SerializeAddon;
  private charset: CharsetState;
  private chain: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(event: TerminalEvent) => void>();
  private sequence = 0;
  private tail = "";
  private queued = 0;
  private paused = false;
  private disposed = false;
  private subscriptions: pty.IDisposable[] = [];
  private exitCode: number | undefined;
  private exited = false;
  private resolveExit!: () => void;
  private processExit = new Promise<void>((resolve) => {
    this.resolveExit = resolve;
  });
  private stopping: Promise<void> | undefined;
  constructor(
    readonly id: string,
    cols: number,
    rows: number,
    options: SpawnOptions,
    private codex?: CodexRuntime,
  ) {
    this.terminal = new headless.Terminal({
      cols,
      rows,
      scrollback: options.scrollback,
      allowProposedApi: true,
    });
    this.charset = new CharsetState(this.terminal);
    this.serializer = new serialize.SerializeAddon();
    this.terminal.loadAddon(this.serializer);
    this.terminal.loadAddon(new unicode.Unicode11Addon());
    this.terminal.unicode.activeVersion = "11";
    try {
      this.process = pty.spawn(options.shell, options.args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd: options.cwd,
        env: options.env,
      });
    } catch (error) {
      this.terminal.dispose();
      throw error;
    }
    this.subscriptions.push(
      // Startup queries may arrive before a renderer attaches. A snapshot cannot
      // replay a consumed query; answer it here only while no live view owns it.
      this.terminal.onData((reply) => {
        if (
          !this.disposed &&
          this.exitCode === undefined &&
          this.listeners.size === 0
        )
          this.process.write(reply);
      }),
      this.process.onData((data) => this.ingest(data)),
      this.process.onExit(({ exitCode }) => {
        this.exited = true;
        this.resolveExit();
        void this.codex?.dispose().catch(() => {
          for (const event of this.codex!.events.error())
            this.agentEvent(event);
        });
        void this.enqueue(() => {
          this.exitCode = exitCode;
          this.emit({ type: "exit", sessionId: id, exitCode });
        });
      }),
    );
  }
  private enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = this.chain.then(fn);
    this.chain = next.catch(() => {});
    return next;
  }
  private ingest(data: string) {
    if (this.disposed) return;
    this.queued += Buffer.byteLength(data);
    if (this.queued > 8 * 1024 * 1024) {
      this.process.kill();
      return;
    }
    if (this.queued > 1024 * 1024 && !this.paused) {
      this.process.pause();
      this.paused = true;
    }
    void this.enqueue(async () => {
      await new Promise<void>((resolve) => this.terminal.write(data, resolve));
      this.tail = advancePartialEscapeTail(this.tail, data);
      this.sequence++;
      this.emit({
        type: "data",
        sessionId: this.id,
        data,
        sequence: this.sequence,
      });
      this.queued -= Buffer.byteLength(data);
      if (this.paused && this.queued < 256 * 1024 && !this.disposed) {
        this.process.resume();
        this.paused = false;
      }
    });
  }
  info(): SessionInfo {
    return {
      id: this.id,
      pid: this.process.pid,
      cols: this.terminal.cols,
      rows: this.terminal.rows,
      status: this.exitCode === undefined ? "running" : "exited",
      ...(this.exitCode !== undefined ? { exitCode: this.exitCode } : {}),
    };
  }
  agentEvent(event: AgentEvent) {
    if (!this.disposed) void this.enqueue(() => this.emit(event));
  }
  private capture(): Snapshot {
    return {
      ...this.info(),
      ...(this.codex ? { agentEvents: [...this.codex.events.history] } : {}),
      sequence: this.sequence,
      ansi:
        serializeWithAbsoluteCursor(
          this.serializer,
          this.terminal,
          undefined,
          readSavedCursorRegister(this.terminal),
        ) +
        this.charset.serialize() +
        this.tail,
    };
  }
  snapshot() {
    return this.enqueue(() => this.capture());
  }
  attach(listener: (e: TerminalEvent) => void) {
    return this.enqueue(() => {
      if (this.disposed) throw new Error("Session closed");
      listener({
        type: "snapshot",
        sessionId: this.id,
        snapshot: this.capture(),
      });
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    });
  }
  write(data: string | Buffer) {
    if (this.disposed || this.exitCode !== undefined)
      throw new Error("Session has exited");
    this.process.write(data);
  }
  resize(cols: number, rows: number) {
    return this.enqueue(() => {
      if (this.disposed) throw new Error("Session closed");
      if (this.terminal.cols === cols && this.terminal.rows === rows) return;
      if (this.exitCode === undefined) this.process.resize(cols, rows);
      this.terminal.resize(cols, rows);
      this.emit({ type: "resize", sessionId: this.id, cols, rows });
    });
  }
  private emit(event: TerminalEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* One observer cannot break PTY draining. */
      }
    }
  }
  private async waitForExit(timeoutMs: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.processExit,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    return this.exited;
  }
  dispose(): Promise<void> {
    return (this.stopping ??= this.stop().catch((error) => {
      this.stopping = undefined;
      throw error;
    }));
  }
  private async stop() {
    this.disposed = true;
    if (!this.exited) {
      // Keep the exit subscription alive until the owned PTY has terminated.
      // A shell can ignore SIGHUP, so explicit close has a bounded fallback.
      this.process.kill();
      if (!(await this.waitForExit(750))) {
        this.process.kill("SIGKILL");
        if (!(await this.waitForExit(1500)))
          throw new Error(`PTY ${this.id} did not terminate`);
      }
    }
    await this.codex?.dispose();
    for (const subscription of this.subscriptions) subscription.dispose();
    await this.chain;
    this.emit({ type: "closed", sessionId: this.id });
    this.listeners.clear();
    this.charset.dispose();
    this.terminal.dispose();
  }
}
