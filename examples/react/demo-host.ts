import { createTerminalServer } from "../../src/server/index.js";
export function startDemoHost() {
  const uiPort = Number(process.env.TERMINAL_UI_PORT ?? 5186);
  return createTerminalServer({
    port: Number(process.env.TERMINAL_API_PORT ?? 5187),
    token: process.env.TERMINAL_TOKEN ?? "local-demo-token",
    allowedOrigins: [
      `http://127.0.0.1:${uiPort}`,
      `http://localhost:${uiPort}`,
    ],
    hostOptions: {
      ...(process.env.TERMINAL_PROGRAM === "codex"
        ? {
            codex: {
              ...(process.env.TERMINAL_CODEX_PROMPT
                ? { prompt: process.env.TERMINAL_CODEX_PROMPT }
                : {}),
            },
          }
        : {}),
      cwd: process.cwd(),
      shellProfile: process.argv.includes("--clean-shell") ? "clean" : "user",
      ...(process.env.TERMINAL_DEMO_SHELL
        ? { shell: process.env.TERMINAL_DEMO_SHELL }
        : {}),
    },
  });
}
