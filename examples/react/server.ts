import { startDemoHost } from "./demo-host.js";
const server = await startDemoHost();
console.log(`Local terminal host: ${server.url}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });
