import { validId } from "@nowly/terminal";

/** One trusted renderer forwards the public protocol; admin control stays in main. */
export function bindTerminalIpc({ ipcMain, window, transport, rendererUrl }) {
  const channel = "nowly-terminal:request";
  const statusChannel = "nowly-terminal:status";
  const attached = new Map();
  let generation = 0,
    disposed = false;
  let queue = Promise.resolve();
  const trusted = (event) =>
    !disposed &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame.url === rendererUrl;
  const send = (channel, payload) => {
    if (!disposed && !window.webContents.isDestroyed())
      window.webContents.send(channel, payload);
  };
  const offEvents = transport.subscribe((event) => {
    if (attached.get(event.sessionId) === generation)
      send("nowly-terminal:event", event);
  });
  const offStatus = transport.onStatus((status) => send(statusChannel, status));
  const reset = () => {
    generation++;
    const ids = [...attached.keys()];
    attached.clear();
    queue = queue.then(async () => {
      for (const id of ids)
        try {
          await transport.request("detach", { id });
        } catch {}
    });
  };
  const navigated = (_event, _url, _inPlace, mainFrame) => {
    if (mainFrame) reset();
  };
  window.webContents.on("did-start-navigation", navigated);
  window.webContents.once("destroyed", reset);
  ipcMain.handle(statusChannel, (event) => {
    if (!trusted(event)) throw Error("Untrusted terminal sender");
    return transport.status;
  });
  ipcMain.handle(channel, (event, method, params) => {
    if (!trusted(event)) throw Error("Untrusted terminal sender");
    const requestedGeneration = generation;
    const run = async () => {
      if (disposed || requestedGeneration !== generation)
        throw Error("Terminal view replaced");
      if (!params || typeof params !== "object" || Array.isArray(params))
        throw Error("Invalid terminal parameters");
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
        throw Error("Unsupported terminal method");
      if (method !== "list") validId(params.id);
      if (method === "attach") {
        attached.set(params.id, requestedGeneration);
        try {
          const result = await transport.request(method, params);
          if (disposed || generation !== requestedGeneration) {
            attached.delete(params.id);
            await transport.request("detach", { id: params.id });
          }
          return result;
        } catch (error) {
          attached.delete(params.id);
          throw error;
        }
      }
      if (method === "detach") attached.delete(params.id);
      const result = await transport.request(method, params);
      if (method === "close") attached.delete(params.id);
      return result;
    };
    const next = queue.then(run);
    queue = next.catch(() => {});
    return next;
  });
  return async () => {
    disposed = true;
    generation++;
    attached.clear();
    offEvents();
    offStatus();
    ipcMain.removeHandler(channel);
    ipcMain.removeHandler(statusChannel);
    if (!window.webContents.isDestroyed())
      window.webContents.removeListener("did-start-navigation", navigated);
    transport.dispose();
    await queue;
  };
}
