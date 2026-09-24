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

test.skipIf(!existsSync("/bin/zsh"))(
  "default zsh initializes login PATH and interactive aliases",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "terminal-login-"));
    writeFileSync(
      join(dir, ".zprofile"),
      `export TERMINAL_LOGIN_VALUE=login_loaded\nexport PATH="${dir}:$PATH"\n`,
    );
    writeFileSync(
      join(dir, ".zshrc"),
      "alias terminal_profile_alias='printf ALIAS_WORKS'\nPS1='PROFILE_READY> '\n",
    );
    const host = new TerminalHost({
      shell: "/bin/zsh",
      cwd: dir,
      env: { ZDOTDIR: dir },
    });
    try {
      host.create({ id: "normal" });
      await expect
        .poll(async () => (await host.snapshot("normal")).ansi)
        .toContain("PROFILE_READY>");
      host.write(
        "normal",
        "printf '%s\\n' \"$TERMINAL_LOGIN_VALUE\"; terminal_profile_alias; print -r -- $PATH\r",
      );
      await expect
        .poll(async () => (await host.snapshot("normal")).ansi)
        .toContain("ALIAS_WORKS");
      const screen = (await host.snapshot("normal")).ansi;
      expect(screen).toContain("login_loaded");
      expect(screen).toContain(dir + ":");
    } finally {
      await host.dispose();
      rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  },
);

test.skipIf(!existsSync("/bin/zsh"))(
  "startup terminal queries receive a reply before any view attaches",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "terminal-query-"));
    writeFileSync(
      join(dir, ".zshrc"),
      "stty -echo -icanon\nprintf '\\033[6n'\nIFS= read -r -t 2 -d R reply\nif [[ $reply == $'\\e['* ]]; then print QUERY_REPLIED; fi\nstty echo icanon\nPS1='QUERY_READY> '\n",
    );
    const host = new TerminalHost({
      shell: "/bin/zsh",
      cwd: dir,
      env: { ZDOTDIR: dir },
    });
    try {
      host.create({ id: "query" });
      await expect
        .poll(async () => (await host.snapshot("query")).ansi, {
          timeout: 3500,
        })
        .toContain("QUERY_REPLIED");
    } finally {
      await host.dispose();
      rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  },
);
