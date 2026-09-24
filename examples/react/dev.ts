import { createServer } from "vite";
import { startDemoHost } from "./demo-host.js";
const host = await startDemoHost();
try {
  const ui = await createServer({
    configFile: "examples/react/vite.config.ts",
  });
  await ui.listen();
  console.log("Local terminal ready. Commands run on this computer.");
  ui.printUrls();
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      if (closing) return;
      closing = true;
      void Promise.all([ui.close(), host.close()]).then(() => process.exit(0));
    });
} catch (error) {
  await host.close();
  throw error;
}
