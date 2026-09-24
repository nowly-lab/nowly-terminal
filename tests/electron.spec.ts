import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

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
  const app = await electron.launch({
    executablePath: createRequire(join(example, "package.json"))("electron"),
    args: [example],
    env,
  });
  let ownedPids: number[] = [];
  try {
    const page = await app.firstWindow();
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
      keys: ["request", "subscribe"],
    });
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
    ownedPids = (await sessions()).map(
      (session: { pid: number }) => session.pid,
    );
    await page.screenshot({ path: "test-results/native-terminal.png" });
    expect(errors).toEqual([]);
    await page.getByRole("button", { name: "Close pane" }).first().click();
    await expect.poll(async () => (await sessions()).length).toBe(1);
  } finally {
    await app.close();
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
