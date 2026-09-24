const { app, BrowserWindow, ipcMain } = require("electron");
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
    const { TerminalHost } = await import("@nowly/terminal/server");
    const { bindTerminalIpc } = await import("./terminal-ipc.mjs");
    const host = new TerminalHost({
      cwd: process.env.TERMINAL_CWD || homedir(),
    });
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
    dispose = bindTerminalIpc({
      ipcMain,
      window,
      host,
      rendererUrl: pathToFileURL(file).href,
    });
    window.once("ready-to-show", () => {
      if (process.env.TERMINAL_EXAMPLE_BACKGROUND !== "1") window.show();
    });
    await window.loadFile(file);
  })
  .catch((error) => {
    console.error(error);
    app.quit();
  });
