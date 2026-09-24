import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { TerminalHost } from "../src/server/host.js";

test.skipIf(!existsSync("/bin/zsh"))(
  "clean zsh skips slow user configuration but executes local tools with inherited PATH",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "terminal-profile-"));
    writeFileSync(join(dir, ".zshrc"), "print PROFILE_LOADED; sleep 2\n");
    const host = new TerminalHost({
      shell: "/bin/zsh",
      shellProfile: "clean",
      cwd: dir,
      env: { ZDOTDIR: dir, PS1: "READY> " },
    });
    try {
      host.create({ id: "clean" });
      await expect
        .poll(async () => (await host.snapshot("clean")).ansi, {
          timeout: 1000,
        })
        .toContain("READY>");
      host.write("clean", "pwd; node -p '6 * 7'\r");
      await expect
        .poll(async () => (await host.snapshot("clean")).ansi)
        .toContain("42");
      const screen = (await host.snapshot("clean")).ansi;
      expect(screen).toContain(dir);
      expect(screen).not.toContain("PROFILE_LOADED");
    } finally {
      await host.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
