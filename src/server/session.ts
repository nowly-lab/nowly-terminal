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
  constructor(
    readonly id: string,
    cols: number,
    rows: number,
    options: SpawnOptions,
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
  private capture(): Snapshot {
    return {
      ...this.info(),
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
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const subscription of this.subscriptions) subscription.dispose();
    if (this.exitCode === undefined) this.process.kill();
    await this.chain;
    this.emit({ type: "closed", sessionId: this.id });
    this.listeners.clear();
    this.charset.dispose();
    this.terminal.dispose();
  }
}
