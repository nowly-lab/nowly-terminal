export type ConnectionStatus =
  "connecting" | "ready" | "disconnected" | "disposed";
export interface CreateSession {
  id: string;
  cols?: number;
  rows?: number;
}
export interface SessionInfo {
  id: string;
  pid: number;
  cols: number;
  rows: number;
  status: "running" | "exited";
  exitCode?: number;
}
export interface Snapshot extends SessionInfo {
  agentEvents?: AgentEvent[];
  ansi: string;
  sequence: number;
}
export type AgentEventKind =
  | "session.started"
  | "task.started"
  | "task.completed"
  | "task.failed"
  | "task.interrupted"
  | "subagent.spawned"
  | "subagent.started"
  | "subagent.completed"
  | "subagent.failed"
  | "subagent.interrupted"
  | "tool.started"
  | "tool.completed"
  | "connection.failed";
export interface AgentEvent {
  type: "agent";
  provider: "codex";
  sessionId: string;
  sequence: number;
  timestamp: string;
  kind: AgentEventKind;
  threadId: string;
  parentThreadId?: string;
  turnId?: string;
  itemId?: string;
  tool?: string;
  status?: string;
}
export type TerminalEvent =
  | AgentEvent
  | { type: "snapshot"; sessionId: string; snapshot: Snapshot }
  | { type: "data"; sessionId: string; data: string; sequence: number }
  | { type: "resize"; sessionId: string; cols: number; rows: number }
  | { type: "exit"; sessionId: string; exitCode: number }
  | { type: "closed"; sessionId: string };
export interface Requests {
  create: { params: CreateSession; result: SessionInfo };
  list: { params: Record<string, never>; result: SessionInfo[] };
  attach: { params: { id: string }; result: null };
  detach: { params: { id: string }; result: null };
  write: {
    params: { id: string; data: string; encoding?: "utf8" | "binary" };
    result: null;
  };
  resize: { params: { id: string; cols: number; rows: number }; result: null };
  close: { params: { id: string }; result: null };
}
export type Method = keyof Requests;
export interface TerminalTransport {
  readonly status: ConnectionStatus;
  request<M extends Method>(
    method: M,
    params: Requests[M]["params"],
  ): Promise<Requests[M]["result"]>;
  subscribe(listener: (event: TerminalEvent) => void): () => void;
  onStatus(listener: (status: ConnectionStatus) => void): () => void;
}
export function validId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !/^[\w-]{1,128}$/.test(id))
    throw new Error("Invalid session id");
}
export function validSize(cols: unknown, rows: unknown): void {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    Number(cols) < 2 ||
    Number(cols) > 500 ||
    Number(rows) < 1 ||
    Number(rows) > 300
  )
    throw new Error("Invalid terminal dimensions");
}
export const MAX_INPUT_LENGTH = 64 * 1024;
