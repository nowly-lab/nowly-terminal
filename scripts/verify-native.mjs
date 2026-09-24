import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const manager = process.env.npm_execpath;
assert.ok(manager, "Run pnpm test:native-package");
function run(command, args, cwd, env = process.env) {
  const r = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    timeout: 240000,
  });
  if (r.error) throw r.error;
  assert.equal(r.status, 0, `${command} failed`);
}
run(process.execPath, [manager, "native:pack"], root);
const temp = realpathSync(mkdtempSync(join(tmpdir(), "native-consumer-")));
try {
  const { version } = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  const name = `nowly-terminal-native-example-${version}`;
  run("tar", ["-xzf", join(root, `${name}.tgz`), "-C", temp], root);
  const example = join(temp, name, "examples/electron");
  const lock = JSON.parse(
    readFileSync(join(example, "package-lock.json"), "utf8"),
  );
  const bytes = readFileSync(join(temp, name, `nowly-lab-terminal-${version}.tgz`));
  assert.equal(
    lock.packages["node_modules/@nowly-lab/terminal"].integrity,
    "sha512-" + createHash("sha512").update(bytes).digest("base64"),
  );
  const env = { ...process.env, npm_config_cache: join(temp, "cache") };
  delete env.ELECTRON_RUN_AS_NODE;
  // Fresh cache prevents an old same-version tarball masking an integrity mismatch.
  run("npm", ["ci", "--ignore-scripts", "--no-audit"], example, env);
  run(process.execPath, ["node_modules/electron/install.js"], example, env);
  run("npm", ["run", "rebuild"], example, env);
  run("npm", ["run", "build"], example, env);
  run(process.execPath, [manager, "test:native"], root, {
    ...env,
    TERMINAL_NATIVE_EXAMPLE: example,
  });
  console.log(
    "Standalone native archive: fresh-cache install, build, shell/IPC/lifecycle tests PASS",
  );
} finally {
  rmSync(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
