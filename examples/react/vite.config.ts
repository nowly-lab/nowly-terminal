import { defineConfig } from "vite";
export default defineConfig({
  root: "examples/react",
  server: { host: "127.0.0.1", port: 5186, strictPort: true },
  build: { outDir: "../../dist-demo" },
});
