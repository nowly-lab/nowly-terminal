import type {
  TerminalTransport,
  TerminalEvent,
  ConnectionStatus,
  Method,
  Requests,
} from "@nowly/terminal";
interface TerminalBridge {
  request<M extends Method>(
    method: M,
    params: Requests[M]["params"],
  ): Promise<Requests[M]["result"]>;
  subscribe(listener: (event: TerminalEvent) => void): () => void;
  onStatus(listener: (status: ConnectionStatus) => void): () => void;
}
declare global {
  interface Window {
    terminal: TerminalBridge;
  }
}
export class IpcTransport implements TerminalTransport {
  private state: ConnectionStatus = "connecting";
  private listeners = new Set<(status: ConnectionStatus) => void>();
  constructor() {
    window.terminal.onStatus((status) => {
      this.state = status;
      for (const listener of this.listeners) listener(status);
    });
  }
  get status() {
    return this.state;
  }
  request<M extends Method>(method: M, params: Requests[M]["params"]) {
    return window.terminal.request(method, params);
  }
  subscribe(listener: (event: TerminalEvent) => void) {
    return window.terminal.subscribe(listener);
  }
  onStatus(listener: (status: ConnectionStatus) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
