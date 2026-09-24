import { defineConfig } from "vite";
export default defineConfig({
  root: "examples/react",
  server: {
    host: "127.0.0.1",
    port: Number(process.env.TERMINAL_UI_PORT ?? 5186),
    strictPort: true,
    proxy: {
      "/terminal": {
        target: `ws://127.0.0.1:${process.env.TERMINAL_API_PORT ?? 5187}`,
        ws: true,
      },
    },
  },
  build: { outDir: "../../dist-demo" },
});
