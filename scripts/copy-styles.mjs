import { copyFileSync, chmodSync } from "node:fs";
copyFileSync("src/styles.css", "dist/styles.css");

chmodSync("dist/cli.js", 0o755);
