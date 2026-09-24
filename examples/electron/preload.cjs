const { contextBridge, ipcRenderer } = require("electron");
// Expose the terminal protocol only, never ipcRenderer, filesystem or process.
contextBridge.exposeInMainWorld("terminal", {
  request: (method, params) =>
    ipcRenderer.invoke("nowly-terminal:request", method, params),
  subscribe: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("nowly-terminal:event", handler);
    return () => ipcRenderer.removeListener("nowly-terminal:event", handler);
  },
});
