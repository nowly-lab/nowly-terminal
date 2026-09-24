const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { homedir } = require("node:os");
if (process.env.TERMINAL_EXAMPLE_USER_DATA)
  app.setPath("userData", process.env.TERMINAL_EXAMPLE_USER_DATA);
app.setName("Nowly Terminal");
let dispose;
let quitting = false;
app.on("before-quit", (event) => {
  if (quitting || !dispose) return;
  event.preventDefault();
  quitting = true;
  void dispose().finally(() => app.quit());
});
app.on("window-all-closed", () => app.quit());
app
  .whenReady()
  .then(async () => {
    const { ensureTerminalDaemon } = await import("@nowly-lab/terminal/daemon");
    const { bindTerminalIpc } = await import("./terminal-ipc.mjs");
    const codex = process.env.TERMINAL_PROGRAM !== "shell";
    const transport = await ensureTerminalDaemon({
      runtimeDir: path.join(
        app.getPath("userData"),
        codex ? "terminal-daemon-codex" : "terminal-daemon",
      ),
      executablePath: process.execPath,
      hostOptions: {
        cwd: process.env.TERMINAL_CWD || (codex ? process.cwd() : homedir()),
        ...(codex
          ? {
              codex: {
                executable: process.env.TERMINAL_CODEX_EXECUTABLE || "codex",
                args: process.env.TERMINAL_CODEX_ARGS
                  ? JSON.parse(process.env.TERMINAL_CODEX_ARGS)
                  : [],
                ...(process.env.TERMINAL_CODEX_PROMPT
                  ? { prompt: process.env.TERMINAL_CODEX_PROMPT }
                  : {}),
              },
            }
          : {}),
      },
    });
    dispose = async () => transport.dispose();
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "Nowly Terminal",
          submenu: [
            {
              label: "すべてのターミナルを終了してアプリを終了",
              id: "stop-terminals",
              click: async () => {
                try {
                  await transport.shutdown();
                  app.quit();
                } catch (error) {
                  dialog.showErrorBox("終了できませんでした", String(error));
                }
              },
            },
            { type: "separator" },
            { role: "quit", label: "アプリを終了（ターミナルは維持）" },
          ],
        },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ]),
    );
    const window = new BrowserWindow({
      width: 1200,
      height: 800,
      show: false,
      backgroundColor: "#101419",
      title: "Nowly Terminal",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    window.webContents.session.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    window.webContents.session.setPermissionCheckHandler(() => false);
    const file = path.join(__dirname, "dist/index.html");
    const rendererUrl = pathToFileURL(file);
    rendererUrl.searchParams.set("program", codex ? "codex" : "shell");
    dispose = bindTerminalIpc({
      ipcMain,
      window,
      transport,
      rendererUrl: rendererUrl.href,
    });
    window.once("ready-to-show", () => {
      if (process.env.TERMINAL_EXAMPLE_BACKGROUND !== "1") window.show();
    });
    await window.loadURL(rendererUrl.href);
  })
  .catch(async (error) => {
    const message =
      "ターミナルを起動できませんでした。サンプルのディレクトリで npm run rebuild と npm run build を実行してください。\n\n" +
      (error instanceof Error ? error.message : String(error));
    console.error(message);
    if (process.env.TERMINAL_EXAMPLE_BACKGROUND !== "1")
      dialog.showErrorBox("Nowly Terminal — 起動エラー", message);
    quitting = true;
    try {
      await dispose?.();
    } finally {
      app.exit(1);
    }
  });
