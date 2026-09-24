import { writeFileSync } from "node:fs";
import WebSocket from "ws";
if (process.argv.includes("app-server")) {
  if (process.env.FAKE_PID_FILE)
    writeFileSync(process.env.FAKE_PID_FILE, String(process.pid));
  let carry = "",
    threads = 0;
  process.stdin.on("data", (chunk) => {
    carry += chunk;
    let at;
    while ((at = carry.indexOf("\n")) >= 0) {
      const frame = JSON.parse(carry.slice(0, at));
      carry = carry.slice(at + 1);
      if (frame.id === undefined) continue;
      if (process.env.FAKE_MODE === "exit") process.exit(9);
      if (process.env.FAKE_MODE === "oversize") {
        process.stdout.write("x".repeat(65 * 1024 * 1024));
        continue;
      }
      if (process.env.FAKE_MODE === "timeout") continue;
      const threadId =
        frame.method === "thread/start"
          ? ++threads === 1
            ? "test-root"
            : `test-root-${threads}`
          : "";
      const result =
        frame.method === "big"
          ? { blob: "x".repeat(9 * 1024 * 1024) }
          : frame.method === "thread/start"
            ? { thread: { id: threadId } }
            : {};
      const out =
        JSON.stringify(
          process.env.FAKE_MODE === "error"
            ? { id: frame.id, error: { message: "fixture refusal" } }
            : { id: frame.id, result },
        ) + "\n";
      process.stdout.write(out.slice(0, 5));
      process.stdout.write(out.slice(5));
      if (frame.method === "thread/start") {
        if (process.env.FAKE_MODE === "internal") {
          process.stdout.write(
            JSON.stringify({
              method: "thread/started",
              params: {
                thread: {
                  id: "internal-thread",
                  source: "vscode",
                },
              },
            }) + "\n",
          );
          process.stdout.write(
            JSON.stringify({
              method: "turn/completed",
              params: {
                threadId: "internal-thread",
                turn: { id: "internal-turn", status: "completed" },
              },
            }) + "\n",
          );
        }
        process.stdout.write(
          JSON.stringify({
            method: "thread/started",
            params: { thread: { id: threadId, source: "vscode" } },
          }) + "\n",
        );
        if (process.env.FAKE_MODE === "final-message")
          setTimeout(() => {
            process.stdout.write(
              JSON.stringify({
                method: "item/completed",
                params: {
                  threadId,
                  turnId: "turn",
                  item: {
                    type: "agentMessage",
                    id: "answer",
                    text: "FINAL_REPLY_42",
                    phase: "final_answer",
                  },
                },
              }) + "\n",
            );
            process.stdout.write(
              JSON.stringify({
                method: "turn/completed",
                params: {
                  threadId,
                  turn: { id: "turn", status: "completed", items: [] },
                },
              }) + "\n",
            );
          }, 100);
        setTimeout(
          () =>
            process.stdout.write(
              JSON.stringify({
                method: "turn/started",
                params: {
                  threadId,
                  turn: { id: "turn", status: "inProgress" },
                },
              }) + "\n",
            ),
          25,
        );
      }
    }
  });
} else {
  const endpoint = process.argv[process.argv.indexOf("--remote") + 1].slice(7);
  const socket = new WebSocket(`ws+unix://${endpoint}:/`);
  socket.on("open", () =>
    socket.send(
      JSON.stringify({
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: "fixture", version: "1" } },
      }),
    ),
  );
  socket.on("message", (bytes) => {
    const frame = JSON.parse(bytes);
    if (frame.id === 1) {
      socket.send(JSON.stringify({ method: "initialized", params: {} }));
      socket.send(
        JSON.stringify({ id: 2, method: "thread/start", params: {} }),
      );
    }
    if (frame.id === 2) process.stdout.write("CODEX_TUI_FIXTURE\n");
  });
  socket.on("error", () => process.exit(1));
  socket.on("close", () => process.exit(0));
}
