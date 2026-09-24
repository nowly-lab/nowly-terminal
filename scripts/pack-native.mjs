import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  cpSync,
  copyFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} failed: ${result.status}`);
}
if (!process.env.npm_execpath) throw Error("Run pnpm native:pack");
run(process.execPath, [process.env.npm_execpath, "pack"], root);
const temp = mkdtempSync(join(tmpdir(), "native-source-"));
try {
  const name = `nowly-terminal-native-example-${version}`;
  const folder = join(temp, name);
  cpSync(join(root, "examples/electron"), join(folder, "examples/electron"), {
    recursive: true,
    filter: (source) =>
      !["node_modules", "dist", ".DS_Store"].includes(basename(source)),
  });
  copyFileSync(
    join(root, `nowly-terminal-${version}.tgz`),
    join(folder, `nowly-terminal-${version}.tgz`),
  );
  copyFileSync(
    join(root, "examples/electron/README.md"),
    join(folder, "README.md"),
  );
  copyFileSync(join(root, "LICENSE"), join(folder, "LICENSE"));
  run("tar", ["-czf", join(root, `${name}.tgz`), "-C", temp, name], root);
  console.log(`Native source archive: ${join(root, `${name}.tgz`)}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
