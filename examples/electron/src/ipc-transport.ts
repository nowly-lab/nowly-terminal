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
}
declare global {
  interface Window {
    terminal: TerminalBridge;
  }
}
export class IpcTransport implements TerminalTransport {
  readonly status: ConnectionStatus = "ready";
  request<M extends Method>(method: M, params: Requests[M]["params"]) {
    return window.terminal.request(method, params);
  }
  subscribe(listener: (event: TerminalEvent) => void) {
    return window.terminal.subscribe(listener);
  }
  onStatus(_listener: (status: ConnectionStatus) => void) {
    return () => {};
  }
}
