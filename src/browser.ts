import { Terminal, type ITerminalOptions } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { TerminalTransport, TerminalEvent } from "./protocol.js";
export interface MountTerminalOptions {
  transport: TerminalTransport;
  sessionId: string;
  terminalOptions?: ITerminalOptions;
  onState?: (state: string) => void;
  onError?: (error: Error) => void;
  onTitle?: (title: string) => void;
}
export interface TerminalHandle {
  focus(): void;
  paste(text: string): void;
  findNext(text: string): boolean;
  findPrevious(text: string): boolean;
  clearSearch(): void;
  dispose(): void;
}
const bindings = new WeakMap<TerminalTransport, Set<string>>();
export function mountTerminal(
  element: HTMLElement,
  options: MountTerminalOptions,
): TerminalHandle {
  const { transport, sessionId } = options;
  let bound = bindings.get(transport);
  if (!bound) {
    bound = new Set();
    bindings.set(transport, bound);
  }
  if (bound.has(sessionId))
    throw new Error(
      "Use a separate transport to display the same session twice",
    );
  bound.add(sessionId);
  const terminal = new Terminal({
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 13,
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: true,
    theme: {
      background: "#101318",
      foreground: "#dde3ed",
      cursor: "#9fbaff",
      selectionBackground: "#42577c",
    },
    ...options.terminalOptions,
  });
  const fit = new FitAddon(),
    search = new SearchAddon();
  terminal.loadAddon(fit);
  terminal.loadAddon(search);
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = "11";
  terminal.loadAddon(
    new WebLinksAddon((event, url) => {
      if (/^https?:\/\//i.test(url)) {
        event.preventDefault();
        window.open(url, "_blank", "noopener,noreferrer");
      }
    }),
  );
  terminal.open(element);
  element.classList.add("nt-terminal");
  let disposed = false,
    attached = false,
    restoring = false,
    exited = false,
    sequence = 0,
    epoch = 0,
    buffered = 0;
  let output: Promise<void> = Promise.resolve();
  let frame = 0;
  const report = (error: unknown) => {
    if (!disposed)
      options.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
  };
  const state = (value: string) => {
    if (!disposed) {
      element.dataset.terminalState = value;
      options.onState?.(value);
    }
  };
  const requestWrite = (data: string, encoding: "utf8" | "binary" = "utf8") => {
    if (attached && !restoring && !exited && !disposed) {
      void transport
        .request("write", { id: sessionId, data, encoding })
        .catch(report);
    }
  };
  const size = () => {
    if (disposed || !element.clientWidth || !element.clientHeight) return;
    const proposed = fit.proposeDimensions();
    if (!proposed) return;
    const cols = Math.max(2, Math.min(500, proposed.cols)),
      rows = Math.max(1, Math.min(300, proposed.rows));
    if (terminal.cols === cols && terminal.rows === rows) return;
    terminal.resize(cols, rows);
    if (attached)
      void transport
        .request("resize", { id: sessionId, cols, rows })
        .catch(report);
  };
  const scheduleFit = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(size);
  };
  const write = (data: string) =>
    new Promise<void>((resolve) => terminal.write(data, resolve));
  const render = (event: TerminalEvent) => {
    if (event.sessionId !== sessionId || disposed) return;
    const currentEpoch = epoch;
    const weight = event.type === "data" ? event.data.length : 0;
    buffered += weight;
    if (buffered > 4 * 1024 * 1024) {
      attached = false;
      epoch++;
      buffered = 0;
      state("recovering");
      void attach();
      return;
    }
    output = output
      .then(async () => {
        if (disposed || currentEpoch !== epoch) return;
        if (event.type === "snapshot") {
          attached = false;
          restoring = true;
          terminal.reset();
          terminal.resize(event.snapshot.cols, event.snapshot.rows);
          await write(event.snapshot.ansi);
          restoring = false;
          if (disposed || currentEpoch !== epoch) return;
          sequence = event.snapshot.sequence;
          exited = event.snapshot.status === "exited";
          attached = true;
          state(exited ? "exited" : "running");
          scheduleFit();
        } else if (event.type === "data") {
          if (event.sequence <= sequence) return;
          if (event.sequence !== sequence + 1) {
            void attach();
            return;
          }
          await write(event.data);
          sequence = event.sequence;
        } else if (event.type === "resize") {
          terminal.resize(event.cols, event.rows);
        } else if (event.type === "exit") {
          exited = true;
          state(`exited (${event.exitCode})`);
        } else if (event.type === "closed") {
          attached = false;
          exited = true;
          state("closed");
        }
      })
      .catch(report)
      .finally(() => {
        if (currentEpoch === epoch) buffered = Math.max(0, buffered - weight);
      });
  };
  async function attach() {
    const attempt = ++epoch;
    attached = false;
    buffered = 0;
    state("connecting");
    try {
      await transport.request("create", {
        id: sessionId,
        cols: terminal.cols,
        rows: terminal.rows,
      });
      if (disposed || attempt !== epoch) return;
      await transport.request("attach", { id: sessionId });
    } catch (error) {
      if (attempt === epoch) {
        state("error");
        report(error);
      }
    }
  }
  const unsubscribe = transport.subscribe(render);
  const unsubscribeStatus = transport.onStatus((status) => {
    if (status === "ready") void attach();
    else {
      epoch++;
      attached = false;
      state(status);
    }
  });
  const data = terminal.onData((text) => requestWrite(text)),
    binary = terminal.onBinary((text) => {
      requestWrite(text, "binary");
    });
  const title = terminal.onTitleChange((value) => options.onTitle?.(value));
  const observer = new ResizeObserver(scheduleFit);
  observer.observe(element);
  document.fonts?.ready
    .then(() => {
      if (!disposed) scheduleFit();
    })
    .catch(report);
  size();
  state(transport.status);
  if (transport.status === "ready") void attach();
  return {
    focus: () => terminal.focus(),
    paste: (text) => terminal.paste(text),
    findNext: (text) =>
      search.findNext(text, {
        decorations: {
          matchOverviewRuler: "#6d8acc",
          activeMatchColorOverviewRuler: "#e4c578",
          activeMatchBackground: "#705c2c",
          matchBackground: "#354a6b",
        },
      }),
    findPrevious: (text) => search.findPrevious(text),
    clearSearch: () => search.clearDecorations(),
    dispose() {
      if (disposed) return;
      disposed = true;
      epoch++;
      attached = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      unsubscribe();
      unsubscribeStatus();
      data.dispose();
      binary.dispose();
      title.dispose();
      bound!.delete(sessionId);
      if (transport.status === "ready")
        void transport.request("detach", { id: sessionId }).catch(() => {});
      // Let in-flight parser callbacks settle before releasing xterm internals.
      void output.finally(() => terminal.dispose());
    },
  };
}
