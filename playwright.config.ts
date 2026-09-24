import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "*.spec.ts",
  testIgnore: "electron.spec.ts",
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5196",
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  webServer: [
    {
      command: "pnpm dev:clean",
      env: { TERMINAL_UI_PORT: "5196", TERMINAL_API_PORT: "5197" },
      url: "http://127.0.0.1:5196",
      reuseExistingServer: false,
    },
  ],
});
