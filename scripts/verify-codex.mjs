import { TerminalHost } from "../dist/server/index.js";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
const cwd = mkdtempSync(join(tmpdir(), "nowly-codex-smoke-"));
writeFileSync(join(cwd, "numbers.txt"), "17 25\n");
const prompt =
  "This is a read-only terminal integration smoke test. Read numbers.txt using a local shell command. Spawn exactly one subagent to compute 17 + 25 independently, wait for it to complete, then report CODEX_CAPTURE_OK with the sum. Use the available collaboration spawn tool. Do not edit any files, access connectors, browse, or create additional agents. Do not ask questions. This message authorizes that single bounded delegation.";
const host = new TerminalHost({
  cwd,
  codex: { prompt, sandbox: "read-only", approvalPolicy: "never" },
});
const captured = [];
let cursor = 0,
  screen = "";
try {
  const info = await host.create({ id: "codex-smoke", cols: 110, rows: 32 });
  console.log("Codex TUI PTY created", info.pid);
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const snapshot = await host.snapshot(info.id);
    screen = snapshot.ansi;
    for (const event of snapshot.agentEvents ?? [])
      if (event.sequence > cursor) {
        cursor = event.sequence;
        captured.push(event);
        console.log(
          event.kind,
          event.threadId,
          event.tool ?? event.status ?? "",
        );
      }
    if (
      captured.some((e) => e.kind === "task.completed") &&
      captured.some((e) => e.kind === "subagent.completed") &&
      /CODEX_CAPTURE_OK\s*[:=-]?\s*42/.test(stripVTControlCharacters(screen))
    )
      break;
    if (
      snapshot.status === "exited" ||
      captured.some(
        (e) => e.kind === "task.failed" || e.kind === "connection.failed",
      )
    )
      throw Error("Codex run failed");
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(
    captured.some((e) => e.kind === "task.started"),
    "Missing task.started",
  );
  assert.ok(
    captured.some((e) => e.kind === "subagent.spawned"),
    "Missing subagent.spawned",
  );
  assert.ok(
    captured.some((e) => e.kind === "subagent.completed"),
    "Missing subagent.completed",
  );
  assert.ok(
    captured.some((e) => e.kind === "task.completed"),
    "Missing task.completed",
  );
  assert.match(
    stripVTControlCharacters(screen),
    /CODEX_CAPTURE_OK\s*[:=-]?\s*42/,
  );
  assert.match(
    captured.find((e) => e.kind === "task.completed")?.finalMessage ?? "",
    /CODEX_CAPTURE_OK\s*[:=-]?\s*42/,
  );
  assert.match(
    captured.find((e) => e.kind === "subagent.completed")?.finalMessage ?? "",
    /42/,
  );
  const output = new URL("../docs/evidence/codex-events.json", import.meta.url);
  mkdirSync(new URL("../docs/evidence/", import.meta.url), { recursive: true });
  writeFileSync(
    output,
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        transport: "Codex TUI + private Unix app-server",
        task: "Read two numbers; delegate one addition; wait and report 42",
        events: captured,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Actual Codex task and subagent capture: PASS");
} catch (error) {
  console.error(screen.slice(-7000));
  throw error;
} finally {
  await host.dispose();
  rmSync(cwd, { recursive: true, force: true });
}
