import { createTerminalServer } from "../../src/server/index.js";
const server = await createTerminalServer({
  port: 5187,
  token: process.env.TERMINAL_TOKEN ?? "local-demo-token",
  allowedOrigins: ["http://127.0.0.1:5186", "http://localhost:5186"],
  hostOptions: {
    cwd: process.cwd(),
    ...(process.env.TERMINAL_DEMO_SHELL
      ? { shell: process.env.TERMINAL_DEMO_SHELL, args: [] }
      : {}),
  },
});
console.log(`Terminal demo host: ${server.url}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
