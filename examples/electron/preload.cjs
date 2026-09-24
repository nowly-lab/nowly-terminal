const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("terminal", {
  request: (method, params) =>
    ipcRenderer.invoke("nowly-terminal:request", method, params),
  subscribe: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("nowly-terminal:event", handler);
    return () => ipcRenderer.removeListener("nowly-terminal:event", handler);
  },
  onStatus: (listener) => {
    let active = true,
      received = false;
    const handler = (_event, status) => {
      received = true;
      if (active) listener(status);
    };
    ipcRenderer.on("nowly-terminal:status", handler);
    ipcRenderer
      .invoke("nowly-terminal:status")
      .then((status) => {
        if (active && !received) listener(status);
      })
      .catch(() => {
        if (active && !received) listener("disconnected");
      });
    return () => {
      active = false;
      ipcRenderer.removeListener("nowly-terminal:status", handler);
    };
  },
});
