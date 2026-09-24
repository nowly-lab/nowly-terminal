import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const example = fileURLToPath(
  new URL("../examples/electron/", import.meta.url),
);
function run(command, args, cwd) {
  const r = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const manager = process.env.npm_execpath;
if (!manager) throw Error("Run pnpm native:setup");
run(process.execPath, [manager, "pack"], root);
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
// npm keeps Electron's native rebuild isolated from the root pnpm store.
run("npm", ["install", `../../nowly-lab-terminal-${version}.tgz`], example);
run(process.execPath, ["node_modules/electron/install.js"], example);
run("npm", ["run", "rebuild"], example);
run("npm", ["run", "build"], example);
