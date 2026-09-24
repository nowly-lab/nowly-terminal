import { expect, test } from "vitest";
import { CodexEvents } from "../src/codex/events.js";
test("root turn statuses, duplicates and unknown/unrelated records", () => {
  const e = new CodexEvents("pane", "root");
  const start = {
    threadId: "root",
    turn: { id: "turn", status: "inProgress" },
  };
  expect(e.accept("turn/started", start)[0]).toMatchObject({
    kind: "task.started",
    threadId: "root",
    turnId: "turn",
  });
  expect(e.accept("turn/started", start)).toEqual([]);
  expect(
    e.accept("turn/completed", {
      threadId: "other",
      turn: { id: "t", status: "completed" },
    }),
  ).toEqual([]);
  for (const status of ["completed", "failed", "interrupted"])
    expect(
      e.accept("turn/completed", {
        threadId: "root",
        turn: { id: status, status },
      })[0].kind,
    ).toBe(`task.${status}`);
  expect(
    e.accept("turn/completed", {
      threadId: "root",
      turn: { id: "x", status: "unknown" },
    }),
  ).toEqual([]);
  expect(e.accept("future/event", {})).toEqual([]);
});
test("proven children retain their identity and terminal completion differs from root", () => {
  const e = new CodexEvents("pane", "root");
  const child = {
    id: "child",
    source: { subagent: { thread_spawn: { parent_thread_id: "root" } } },
  };
  expect(e.accept("thread/started", { thread: child })[0].kind).toBe(
    "subagent.spawned",
  );
  expect(e.threads.has("child")).toBe(true);
  expect(
    e.accept("turn/completed", {
      threadId: "child",
      turn: { id: "c", status: "completed" },
    })[0],
  ).toMatchObject({
    kind: "subagent.completed",
    threadId: "child",
    parentThreadId: "root",
  });
  expect(
    e.accept("thread/started", {
      thread: {
        ...child,
        id: "stranger",
        source: { subagent: { thread_spawn: { parent_thread_id: "unknown" } } },
      },
    }),
  ).toEqual([]);
});
test("collaboration discovers children and completion states without leaking payloads", () => {
  const e = new CodexEvents("pane", "root");
  const item = {
    id: "tool",
    type: "collabAgentToolCall",
    tool: "spawnAgent",
    status: "completed",
    receiverThreadIds: ["child"],
    agentsStates: { child: { status: "running", message: "secret" } },
    prompt: "secret",
  };
  const events = e.accept("item/completed", {
    threadId: "root",
    turnId: "t",
    item,
  });
  expect(events.some((x) => x.kind === "subagent.spawned")).toBe(true);
  expect(JSON.stringify(events)).not.toContain("secret");
  const done = {
    ...item,
    id: "wait",
    tool: "wait",
    agentsStates: { child: { status: "completed", message: "secret" } },
  };
  expect(
    e
      .accept("item/completed", { threadId: "root", turnId: "t", item: done })
      .some((x) => x.kind === "subagent.completed"),
  ).toBe(true);
});
test("bounded history, metadata and dedup stay bounded while sequence keeps increasing", () => {
  const e = new CodexEvents("pane", "root");
  for (let i = 0; i < 2500; i++)
    e.accept("item/completed", {
      threadId: "root",
      turnId: "t",
      item: {
        id: String(i),
        type: "commandExecution",
        command: "secret",
        status: "completed",
      },
    });
  expect(e.history).toHaveLength(200);
  expect(e.history.at(-1)?.sequence).toBe(2500);
  expect(JSON.stringify(e.history)).not.toContain("secret");
});

test("late child completion notification does not duplicate an observed wait result", () => {
  const e = new CodexEvents("pane", "root");
  e.accept("item/completed", {
    threadId: "root",
    turnId: "t",
    item: {
      id: "wait",
      type: "collabAgentToolCall",
      tool: "wait",
      receiverThreadIds: ["child"],
      agentsStates: { child: { status: "completed" } },
    },
  });
  expect(
    e.accept("turn/completed", {
      threadId: "child",
      turn: { id: "c", status: "completed" },
    }),
  ).toEqual([]);
  e.accept("turn/started", {
    threadId: "child",
    turn: { id: "next", status: "inProgress" },
  });
  expect(
    e.accept("turn/completed", {
      threadId: "child",
      turn: { id: "next", status: "completed" },
    })[0].kind,
  ).toBe("subagent.completed");
});
