import { useEffect, useState } from "react";
import type { AgentEvent, TerminalTransport } from "./protocol.js";
const labels: Record<AgentEvent["kind"], string> = {
  "session.started": "Codex connected",
  "task.started": "Task started",
  "task.completed": "Task completed",
  "task.failed": "Task failed",
  "task.interrupted": "Task interrupted",
  "subagent.spawned": "Subagent spawned",
  "subagent.started": "Subagent working",
  "subagent.completed": "Subagent completed",
  "subagent.failed": "Subagent failed",
  "subagent.interrupted": "Subagent interrupted",
  "tool.started": "Tool started",
  "tool.completed": "Tool finished",
  "connection.failed": "Codex connection failed",
};
/** Optional event inspector; terminal rendering itself remains provider-agnostic. */
export function AgentActivity({ transport }: { transport: TerminalTransport }) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  useEffect(() => {
    setEvents([]);
    return transport.subscribe((event) => {
      const incoming =
        event.type === "agent"
          ? [event]
          : event.type === "snapshot"
            ? (event.snapshot.agentEvents ?? [])
            : [];
      if (!incoming.length) return;
      setEvents((previous) => {
        const kept =
          event.type === "snapshot"
            ? previous.filter((e) => e.sessionId !== event.sessionId)
            : previous;
        const map = new Map(
          kept.map((e) => [`${e.sessionId}:${e.sequence}`, e]),
        );
        for (const e of incoming) map.set(`${e.sessionId}:${e.sequence}`, e);
        return [...map.values()]
          .sort(
            (a, b) =>
              a.timestamp.localeCompare(b.timestamp) || a.sequence - b.sequence,
          )
          .slice(-200);
      });
    });
  }, [transport]);
  if (!events.length) return null;
  return (
    <aside className="nt-agent-activity" aria-label="Codex activity">
      <h2>
        Codex activity <span>{events.length} events</span>
      </h2>
      <ol>
        {events
          .slice(-40)
          .reverse()
          .map((e) => (
            <li key={`${e.sessionId}:${e.sequence}`} data-agent-kind={e.kind}>
              <time>{new Date(e.timestamp).toLocaleTimeString()}</time>
              <strong>{labels[e.kind]}</strong>
              <span>
                {e.tool ?? (e.parentThreadId ? "child" : "main")} ·{" "}
                {e.threadId.slice(0, 8)}
              </span>
            </li>
          ))}
      </ol>
    </aside>
  );
}
