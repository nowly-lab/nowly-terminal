import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  copyFileSync,
  readFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { connectTerminalDaemon } from "../src/daemon/index.js";

test("native packaged terminal initializes shell, isolates renderer and restores live sessions", async () => {
  const fixture = mkdtempSync(join(tmpdir(), "terminal-native-"));
  writeFileSync(
    join(fixture, ".zprofile"),
    `export NATIVE_LOGIN=LOGIN_LOADED\nexport PATH="${fixture}:$PATH"\n`,
  );
  writeFileSync(
    join(fixture, ".zshrc"),
    `alias native_profile_alias='printf ALIAS_LOADED'\nPS1='NATIVE_READY> '\n`,
  );
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    ZDOTDIR: fixture,
    SHELL: "/bin/zsh",
    TERMINAL_CWD: fixture,
    TERMINAL_EXAMPLE_BACKGROUND: "1",
    TERMINAL_EXAMPLE_USER_DATA: join(fixture, "app"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const example = resolve(
    process.env.TERMINAL_NATIVE_EXAMPLE ?? "examples/electron",
  );
  const launch = () =>
    electron.launch({
      executablePath: createRequire(join(example, "package.json"))("electron"),
      args: [example],
      env,
    });
  let app = await launch();
  let ownedPids: number[] = [];
  try {
    let page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(page.locator('[data-terminal-state="running"]')).toHaveCount(
      1,
    );
    expect(
      await page.evaluate(() => ({
        node: typeof (window as any).require,
        process: typeof (window as any).process,
        keys: Object.keys((window as any).terminal),
      })),
    ).toEqual({
      node: "undefined",
      process: "undefined",
      keys: ["request", "subscribe", "onStatus"],
    });
    await page.getByRole("tab").first().dblclick();
    await page
      .getByRole("textbox", { name: "Terminal name" })
      .fill("Native shell");
    await page.getByRole("textbox", { name: "Terminal name" }).press("Enter");
    await expect(page.getByRole("tab", { name: "Native shell" })).toBeVisible();
    const sessions = () =>
      page.evaluate(() => (window as any).terminal.request("list", {}));
    const original = (await sessions())[0];
    const screen = () =>
      page.evaluate(async (id) => {
        const api = (window as any).terminal;
        return new Promise<string>((resolve, reject) => {
          const off = api.subscribe((event: any) => {
            if (event.type === "snapshot" && event.sessionId === id) {
              off();
              resolve(event.snapshot.ansi);
            }
          });
          api.request("attach", { id }).catch((e: any) => {
            off();
            reject(e);
          });
        });
      }, original.id);
    await expect.poll(screen).toContain("NATIVE_READY>");
    await page.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type(
      "printf '%s\\n' \"$NATIVE_LOGIN\"; native_profile_alias; printf '\\nPATH_OK=%s\\n' \"${PATH%%:*}\"; printf 'NATIVE_%s\\n' EXECUTED",
    );
    await page.keyboard.press("Enter");
    await expect.poll(screen).toContain("NATIVE_EXECUTED");
    const output = await screen();
    expect(output).toContain("LOGIN_LOADED");
    expect(output).toContain("ALIAS_LOADED");
    expect(output).toContain("PATH_OK=" + fixture);
    await expect(
      page.evaluate(() =>
        (window as any).terminal.request("spawn", { command: "bad" }),
      ),
    ).rejects.toThrow("Unsupported");
    await expect(
      page.evaluate(() =>
        (window as any).terminal.request("write", { id: "bad/id", data: "x" }),
      ),
    ).rejects.toThrow("Invalid session id");
    await expect(
      page.evaluate(() => (window as any).terminal.request("shutdown", {})),
    ).rejects.toThrow("Unsupported");
    await page.getByRole("button", { name: "Split right" }).click();
    await expect(page.locator('[data-terminal-state="running"]')).toHaveCount(
      2,
    );
    await page.reload();
    await expect(page.locator('[data-terminal-state="running"]')).toHaveCount(
      2,
    );
    expect((await sessions()).find((s: any) => s.id === original.id).pid).toBe(
      original.pid,
    );
    await expect.poll(screen).toContain("NATIVE_EXECUTED");
    const runtimeDir = join(fixture, "app", "terminal-daemon");
    const daemon = JSON.parse(
      readFileSync(join(runtimeDir, "daemon.json"), "utf8"),
    );
    expect(daemon.pid).not.toBe(app.process().pid);
    await page.evaluate(
      (id) =>
        (window as any).terminal.request("write", {
          id,
          data: "export APP_RESTART_VALUE=preserved; (sleep .3; printf 'APP_OFFLINE_%s\\n' OUTPUT) &\r",
        }),
      original.id,
    );
    await app.close();
    expect(() => process.kill(original.pid, 0)).not.toThrow();
    expect(() => process.kill(daemon.pid, 0)).not.toThrow();
    app = await launch();
    page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(page.locator('[data-terminal-state="running"]')).toHaveCount(
      2,
    );
    expect((await sessions()).find((s: any) => s.id === original.id).pid).toBe(
      original.pid,
    );
    await expect(page.getByRole("tab", { name: "Native shell" })).toBeVisible();
    await expect.poll(screen).toContain("APP_OFFLINE_OUTPUT");
    await page.evaluate(
      (id) =>
        (window as any).terminal.request("write", {
          id,
          data: "printf 'APP_VALUE_%s\\n' \"$APP_RESTART_VALUE\"\r",
        }),
      original.id,
    );
    await expect.poll(screen).toContain("APP_VALUE_preserved");
    ownedPids = [
      daemon.pid,
      ...(await sessions()).map((session: { pid: number }) => session.pid),
    ];
    await page.screenshot({ path: "test-results/native-terminal.png" });
    expect(errors).toEqual([]);
    await page.getByRole("button", { name: "Close pane" }).first().click();
    await expect.poll(async () => (await sessions()).length).toBe(1);
    const appProcess = app.process();
    await app.evaluate(({ Menu }) => {
      void Menu.getApplicationMenu()!
        .getMenuItemById("stop-terminals")!
        .click();
    });
    await expect.poll(() => appProcess.exitCode).toBe(0);
  } finally {
    await app.close().catch(() => {});
    try {
      const daemon = await connectTerminalDaemon(
        join(fixture, "app", "terminal-daemon"),
      );
      ownedPids.push(daemon.info().pid);
      await daemon.shutdown();
      daemon.dispose();
    } catch {}
    await expect
      .poll(() =>
        ownedPids.every((pid) => {
          try {
            process.kill(pid, 0);
            return false;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
            throw error;
          }
        }),
      )
      .toBe(true);
    rmSync(fixture, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});

test("native initialization failure reports rebuild guidance and exits unsuccessfully", async () => {
  const example = resolve(
    process.env.TERMINAL_NATIVE_EXAMPLE ?? "examples/electron",
  );
  const failure = mkdtempSync(join(example, ".startup-failure-"));
  copyFileSync(join(example, "main.cjs"), join(failure, "main.cjs"));
  const env = {
    ...process.env,
    TERMINAL_EXAMPLE_BACKGROUND: "1",
    TERMINAL_EXAMPLE_USER_DATA: join(failure, "user-data"),
  };
  delete (env as NodeJS.ProcessEnv).ELECTRON_RUN_AS_NODE;
  try {
    const child = spawn(
      createRequire(join(example, "package.json"))("electron"),
      [join(failure, "main.cjs")],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let errors = "";
    child.stderr.on("data", (chunk) => (errors += chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", resolve);
    }).finally(() => clearTimeout(timer));
    expect(code).toBe(1);
    expect(errors).toContain("npm run rebuild");
  } finally {
    rmSync(failure, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
