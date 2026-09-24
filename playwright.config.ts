import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "*.spec.ts",
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5186",
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  webServer: [
    {
      command: "pnpm dev",
      env: { TERMINAL_DEMO_SHELL: "/bin/sh" },
      url: "http://127.0.0.1:5187/health",
      reuseExistingServer: false,
    },
    {
      command: "pnpm dev:ui",
      url: "http://127.0.0.1:5186",
      reuseExistingServer: false,
    },
  ],
});
