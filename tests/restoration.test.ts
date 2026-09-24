import { expect, test } from "vitest";
import { TerminalHost } from "../src/server/host.js";
import { advancePartialEscapeTail } from "../src/vendor/orca/terminal-partial-escape-tail.js";
import type { TerminalEvent } from "../src/protocol.js";
test("Orca scanner preserves split ANSI and caps unterminated strings", () => {
  expect(advancePartialEscapeTail("", "hello\x1b[31")).toBe("\x1b[31");
  expect(advancePartialEscapeTail("\x1b[31", "mred")).toBe("");
  expect(advancePartialEscapeTail("", "\x1b]0;" + "x".repeat(5000))).toBe("");
});
test("snapshot boundary and subsequent live output have contiguous sequence", async () => {
  const host = new TerminalHost({
    shell: process.execPath,
    args: [
      "-e",
      `process.stdout.write('BEFORE\\x1b[31');setTimeout(()=>process.stdout.write('mAFTER\\x1b[0m'),350);setTimeout(()=>{},2000)`,
    ],
  });
  try {
    host.create({ id: "boundary" });
    await expect
      .poll(async () => (await host.snapshot("boundary")).ansi)
      .toContain("BEFORE");
    const events: TerminalEvent[] = [];
    const detach = await host.attach("boundary", (e) => events.push(e));
    expect(events[0].type).toBe("snapshot");
    if (events[0].type !== "snapshot") throw new Error();
    expect(events[0].snapshot.ansi.endsWith("\x1b[31")).toBe(true);
    await expect
      .poll(() =>
        events
          .filter((e) => e.type === "data")
          .map((e) => e.data)
          .join(""),
      )
      .toContain("AFTER");
    const firstData = events.find((e) => e.type === "data");
    expect(firstData?.sequence).toBe(events[0].snapshot.sequence + 1);
    detach();
  } finally {
    await host.dispose();
  }
});
test("restored DEC line drawing state continues across reconnect", async () => {
  const headless = await import("@xterm/headless");
  const terminal = new headless.Terminal({ allowProposedApi: true });
  const host = new TerminalHost({
    shell: process.execPath,
    args: ["-e", `process.stdout.write('\\x1b(0q');setTimeout(()=>{},10000)`],
  });
  try {
    host.create({ id: "charset" });
    await expect
      .poll(async () => (await host.snapshot("charset")).ansi)
      .toContain("─");
    const snapshot = await host.snapshot("charset");
    await new Promise<void>((r) => terminal.write(snapshot.ansi + "q", r));
    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe(
      "──",
    );
  } finally {
    terminal.dispose();
    await host.dispose();
  }
});
test.each([
  ["scroll region", "\x1b[2;4r\x1b[3;7HX", "Z", 2, "      XZ"],
  ["saved cursor", "A\x1b7\x1b[3;7HX", "\x1b8Z", 0, "AZ"],
] as const)(
  "restores %s before continuing live output",
  async (_name, before, after, row, expected) => {
    const headless = await import("@xterm/headless");
    const terminal = new headless.Terminal({ allowProposedApi: true });
    const host = new TerminalHost({
      shell: process.execPath,
      args: [
        "-e",
        `process.stdout.write(${JSON.stringify(before)});setTimeout(()=>{},10000)`,
      ],
    });
    try {
      host.create({ id: "state" });
      await expect
        .poll(async () => (await host.snapshot("state")).ansi)
        .toContain("X");
      const snapshot = await host.snapshot("state");
      await new Promise<void>((r) => terminal.write(snapshot.ansi + after, r));
      expect(terminal.buffer.active.getLine(row)?.translateToString(true)).toBe(
        expected,
      );
    } finally {
      terminal.dispose();
      await host.dispose();
    }
  },
);
