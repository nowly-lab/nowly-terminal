import { validId } from "@nowly/terminal";

/** Bind one trusted window to its host. Renderer reloads keep the host alive. */
export function bindTerminalIpc({ ipcMain, window, host, rendererUrl }) {
  const channel = "nowly-terminal:request";
  const subscriptions = new Map();
  let generation = 0;
  let disposed = false;
  let queue = Promise.resolve();
  const reset = () => {
    generation++;
    for (const off of subscriptions.values()) off();
    subscriptions.clear();
  };
  const navigated = (_event, _url, _inPlace, mainFrame) => {
    if (mainFrame) reset();
  };
  window.webContents.on("did-start-navigation", navigated);
  window.webContents.once("destroyed", reset);
  ipcMain.handle(channel, (event, method, params) => {
    if (
      disposed ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== rendererUrl
    )
      throw new Error("Untrusted terminal sender");
    const requestedGeneration = generation;
    const run = async () => {
      if (disposed || generation !== requestedGeneration)
        throw new Error("Terminal view replaced");
      if (!params || typeof params !== "object" || Array.isArray(params))
        throw new Error("Invalid terminal parameters");
      if (
        ![
          "create",
          "list",
          "attach",
          "detach",
          "write",
          "resize",
          "close",
        ].includes(method)
      )
        throw new Error("Unsupported terminal method");
      if (method !== "list") validId(params.id);
      switch (method) {
        case "create":
          return host.create({
            id: params.id,
            cols: params.cols,
            rows: params.rows,
          });
        case "list":
          return host.list();
        case "attach": {
          subscriptions.get(params.id)?.();
          subscriptions.delete(params.id);
          const off = await host.attach(params.id, (payload) => {
            if (
              !disposed &&
              generation === requestedGeneration &&
              !window.webContents.isDestroyed()
            )
              window.webContents.send("nowly-terminal:event", payload);
          });
          if (disposed || generation !== requestedGeneration) off();
          else subscriptions.set(params.id, off);
          return null;
        }
        case "detach":
          subscriptions.get(params.id)?.();
          subscriptions.delete(params.id);
          return null;
        case "write":
          host.write(params.id, params.data, params.encoding);
          return null;
        case "resize":
          await host.resize(params.id, params.cols, params.rows);
          return null;
        case "close":
          await host.close(params.id);
          subscriptions.get(params.id)?.();
          subscriptions.delete(params.id);
          return null;
      }
    };
    const next = queue.then(run);
    queue = next.catch(() => {});
    return next;
  });
  return async () => {
    disposed = true;
    ipcMain.removeHandler(channel);
    reset();
    if (!window.webContents.isDestroyed())
      window.webContents.removeListener("did-start-navigation", navigated);
    await queue;
    await host.dispose();
  };
}
