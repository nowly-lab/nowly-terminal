import type { AgentEvent, AgentEventKind } from "../protocol.js";
export const record = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 && value.length <= 160
    ? value
    : undefined;
/** Metadata-only projection of the app-server stream. Never forwards prompts or output. */
export class CodexEvents {
  readonly threads = new Map<string, string | undefined>();
  readonly history: AgentEvent[] = [];
  private seen = new Set<string>();
  private sequence = 0;
  private childStatus = new Map<string, string>();
  constructor(
    private sessionId: string,
    public rootThreadId: string,
  ) {
    if (rootThreadId) this.threads.set(rootThreadId, undefined);
  }
  /** Only the dedicated TUI runtime may register a new top-level thread. */
  activateRoot(id: string) {
    if (this.threads.get(id)) return;
    if (!this.threads.has(id) && this.threads.size >= 128) {
      // Evict the oldest ownership subtree together; never retain orphan children.
      const remove = new Set([this.threads.keys().next().value!]);
      for (const [thread, parent] of this.threads)
        if (parent && remove.has(parent)) remove.add(thread);
      for (const thread of remove) {
        this.threads.delete(thread);
        this.childStatus.delete(thread);
      }
    }
    this.threads.set(id, undefined);
    this.rootThreadId = id;
  }
  private add(
    key: string,
    kind: AgentEventKind,
    threadId: string,
    extra: Partial<AgentEvent> = {},
  ) {
    if (this.seen.has(key)) return [];
    this.seen.add(key);
    if (this.seen.size > 2048)
      this.seen.delete(this.seen.values().next().value!);
    const event: AgentEvent = {
      type: "agent",
      provider: "codex",
      sessionId: this.sessionId,
      sequence: ++this.sequence,
      timestamp: new Date().toISOString(),
      kind,
      threadId,
      parentThreadId: this.threads.get(threadId),
      ...extra,
    };
    this.history.push(event);
    if (this.history.length > 200) this.history.shift();
    return [event];
  }
  error(status = "disconnected") {
    return this.add(
      `error:${this.sequence}`,
      "connection.failed",
      this.rootThreadId,
      { status },
    );
  }
  private child(id: string, parent: string) {
    if (this.threads.has(id) || this.threads.size >= 128) return [];
    this.threads.set(id, parent);
    return this.add(`spawn:${id}`, "subagent.spawned", id);
  }
  accept(method: string, params: unknown): AgentEvent[] {
    const p = record(params),
      thread = record(p.thread);
    if (method === "thread/started") {
      const id = str(thread.id),
        parent = str(
          thread.parentThreadId ??
            record(
              record(
                record(thread.source).subAgent ??
                  record(thread.source).subagent,
              ).thread_spawn,
            ).parent_thread_id,
        );
      if (!id) return [];
      if (this.threads.has(id) && this.threads.get(id) === undefined)
        return this.add(`session:${id}`, "session.started", id);
      return parent && this.threads.has(parent) ? this.child(id, parent) : [];
    }
    const id = str(p.threadId);
    if (!id || !this.threads.has(id)) return [];
    const child = this.threads.get(id) !== undefined,
      prefix = child ? "subagent" : "task";
    if (method === "turn/started" || method === "turn/completed") {
      const turn = record(p.turn),
        turnId = str(turn.id);
      if (!turnId) return [];
      const status = method === "turn/started" ? "started" : str(turn.status);
      if (
        !status ||
        !["started", "completed", "failed", "interrupted"].includes(status)
      )
        return [];
      if (child) {
        if (this.childStatus.get(id) === `${turnId}:${status}`) return [];
        if (this.childStatus.get(id) === `observed:${status}`) {
          this.childStatus.set(id, `${turnId}:${status}`);
          return [];
        }
        this.childStatus.set(id, `${turnId}:${status}`);
      }
      return this.add(
        `turn:${id}:${turnId}:${status}`,
        `${prefix}.${status}` as AgentEventKind,
        id,
        { turnId, status },
      );
    }
    if (method === "item/started" || method === "item/completed") {
      const item = record(p.item),
        itemId = str(item.id),
        type = str(item.type),
        turnId = str(p.turnId);
      if (!itemId || !type) return [];
      const result: AgentEvent[] = [];
      if (type === "subAgentActivity") {
        const agent = str(item.agentThreadId);
        if (agent) result.push(...this.child(agent, id));
      }
      if (type === "collabAgentToolCall") {
        for (const agent of Array.isArray(item.receiverThreadIds)
          ? item.receiverThreadIds.slice(0, 128)
          : []) {
          if (!str(agent)) continue;
          result.push(...this.child(agent, id));
          if (!this.threads.get(agent)) continue;
          const state = str(record(record(item.agentsStates)[agent]).status);
          if (
            state &&
            ["completed", "errored", "interrupted"].includes(state)
          ) {
            // Turn-level notifications are authoritative when available. A wait result
            // is a fallback for a child which finished before we could subscribe.
            const status = state === "errored" ? "failed" : state;
            const last = this.childStatus.get(agent);
            if (!last?.endsWith(`:${status}`)) {
              this.childStatus.set(agent, `observed:${status}`);
              result.push(
                ...this.add(
                  `child-state:${agent}:${itemId}:${status}`,
                  `subagent.${status}` as AgentEventKind,
                  agent,
                  { status },
                ),
              );
            }
          } else if (state === "running") this.childStatus.delete(agent);
        }
      }
      if (
        [
          "commandExecution",
          "fileChange",
          "mcpToolCall",
          "dynamicToolCall",
          "collabAgentToolCall",
        ].includes(type)
      )
        result.push(
          ...this.add(
            `${method}:${id}:${turnId}:${itemId}`,
            method === "item/started" ? "tool.started" : "tool.completed",
            id,
            {
              turnId,
              itemId,
              tool: str(item.tool) ?? type,
              status: str(item.status),
            },
          ),
        );
      return result;
    }
    return [];
  }
}
