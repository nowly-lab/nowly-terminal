import { expect, test } from "vitest";
import { CodexEvents } from "../src/codex/events.js";
const message = (text: string, phase: string | null = "final_answer") => ({
  type: "agentMessage",
  id: "answer",
  text,
  phase,
});
const complete = (
  e: CodexEvents,
  threadId = "root",
  turnId = "t",
  items: unknown[] = [],
) =>
  e.accept("turn/completed", {
    threadId,
    turn: { id: turnId, status: "completed", items },
  });
const item = (
  e: CodexEvents,
  value: unknown,
  threadId = "root",
  turnId = "t",
) => e.accept("item/completed", { threadId, turnId, item: value });

test("completion contains the last final answer, not commentary or other payloads", () => {
  const e = new CodexEvents("pane", "root");
  item(e, message("working", "commentary"));
  item(e, { type: "reasoning", id: "secret", text: "private reasoning" });
  item(e, { type: "userMessage", id: "input", text: "private prompt" });
  item(e, message("first final"));
  item(e, message("Done.\n42"));
  item(e, message("commentary afterwards", "commentary"));
  const event = complete(e)[0];
  expect(event).toMatchObject({
    kind: "task.completed",
    finalMessage: "Done.\n42",
    finalMessageTruncated: false,
  });
  expect(e.history.at(-1)).toEqual(event);
  expect(complete(e)).toEqual([]);
  expect(JSON.stringify(e.history)).not.toContain("private");
});
test("turn items and legacy phase-less messages are supported; explicit final takes precedence", () => {
  const e = new CodexEvents("pane", "root");
  expect(
    complete(e, "root", "t", [
      message("legacy", null),
      message("last legacy", null),
    ])[0],
  ).toMatchObject({ finalMessage: "last legacy" });
  expect(
    complete(e, "root", "next", [
      message("explicit"),
      message("unknown", null),
    ])[0],
  ).toMatchObject({ finalMessage: "explicit" });
});
test("parent, child, next turns and unrelated threads cannot share answers", () => {
  const e = new CodexEvents("pane", "root");
  e.accept("thread/started", {
    thread: { id: "child", parentThreadId: "root" },
  });
  item(e, message("parent"));
  item(e, message("child"), "child", "c");
  item(e, message("unrelated"), "unknown");
  expect(complete(e, "child", "c")[0]).toMatchObject({
    kind: "subagent.completed",
    finalMessage: "child",
    parentThreadId: "root",
  });
  expect(complete(e)[0]).toMatchObject({ finalMessage: "parent" });
  expect(complete(e, "root", "next")[0]).not.toHaveProperty("finalMessage");
  item(e, message("stale"), "root", "old");
  e.accept("turn/started", { threadId: "root", turn: { id: "new" } });
  expect(complete(e, "root", "new")[0]).not.toHaveProperty("finalMessage");
});
test("commentary, failed/interrupted turns and incomplete items never become final answers", () => {
  for (const status of ["completed", "failed", "interrupted"]) {
    const e = new CodexEvents("pane", "root");
    item(e, message("progress", "commentary"));
    e.accept("item/started", {
      threadId: "root",
      turnId: "t",
      item: message("unfinished"),
    });
    expect(
      e.accept("turn/completed", {
        threadId: "root",
        turn: { id: "t", status },
      })[0],
    ).not.toHaveProperty("finalMessage");
  }
});
test("child wait completion can include its final message without duplicating completion", () => {
  const e = new CodexEvents("pane", "root");
  const events = item(e, {
    id: "wait",
    type: "collabAgentToolCall",
    receiverThreadIds: ["child"],
    agentsStates: { child: { status: "completed", message: "42" } },
    prompt: "secret",
  });
  expect(events.find((e) => e.kind === "subagent.completed")).toMatchObject({
    finalMessage: "42",
    finalMessageTruncated: false,
  });
  expect(complete(e, "child", "c", [message("42")])).toEqual([]);
  expect(JSON.stringify(events)).not.toContain("secret");
});
test("long Unicode answers are bounded without splitting a character", () => {
  const e = new CodexEvents("pane", "root");
  const text = "\uFEFF" + "あ🙂".repeat(4000);
  const event = complete(e, "root", "t", [message(text)])[0];
  expect(event.finalMessageTruncated).toBe(true);
  expect(Buffer.byteLength(event.finalMessage!)).toBeLessThanOrEqual(8192);
  expect(text.startsWith(event.finalMessage!)).toBe(true);
  expect(event.finalMessage).not.toContain("\uFFFD");
});
