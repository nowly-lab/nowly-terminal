import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  realpathSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manager = process.env.npm_execpath;
assert.ok(manager, "Run through npm run test:package or pnpm test:package");
const temporary = realpathSync(
  mkdtempSync(join(tmpdir(), "nowly-terminal-package-")),
);
function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    timeout: 180000,
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}
try {
  console.log("Packing with automatic build…");
  run(
    process.execPath,
    [manager, "pack", "--pack-destination", temporary],
    root,
  );
  const filename = readdirSync(temporary).find((name) => name.endsWith(".tgz"));
  assert.ok(filename);
  const tarball = join(temporary, filename);
  copyFileSync(tarball, join(root, filename));
  writeFileSync(
    join(temporary, "package.json"),
    JSON.stringify({
      name: "independent-terminal-consumer",
      version: "1.0.0",
      private: true,
      type: "module",
      pnpm: {
        onlyBuiltDependencies: ["node-pty", "@nowly/terminal", "esbuild"],
      },
    }),
  );
  console.log("Installing the tarball into an independent consumer…");
  run(
    process.execPath,
    [
      manager,
      "install",
      tarball,
      "react@19",
      "react-dom@19",
      "typescript@5.9",
      "@types/node@24",
      "@types/react@19",
      "@types/react-dom@19",
      "vite@7",
    ],
    temporary,
  );
  const installed = join(temporary, "node_modules/@nowly/terminal");
  assert.ok(!existsSync(join(installed, "examples")));
  assert.ok(!existsSync(join(installed, "tests")));
  run(
    process.execPath,
    [join(installed, "scripts/prepare-pty.mjs")],
    temporary,
  );
  writeFileSync(
    join(temporary, "smoke.mjs"),
    String.raw`
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {WebSocketTransport} from '@nowly/terminal/client';
import {TerminalHost} from '@nowly/terminal/server';
import {validId} from '@nowly/terminal';
validId('consumer');assert.equal(typeof TerminalHost,'function');
assert.match(import.meta.resolve('@nowly/terminal/styles.css'),/styles.css$/);
const secret=randomBytes(24).toString('hex');
const child=spawn(process.execPath,['node_modules/@nowly/terminal/dist/cli.js','serve','--profile','clean','--port','0','--origin','http://localhost:3000'],{env:{...process.env,TERMINAL_TOKEN:secret},stdio:['ignore','pipe','pipe']});
let log='',errors='';child.stdout.on('data',data=>log+=data);child.stderr.on('data',data=>errors+=data);
const exit=new Promise(resolve=>child.once('exit',code=>resolve(code)));
let client;
try {
 const until=Date.now()+10000;let url;
 while(!url&&Date.now()<until){url=log.match(/ws:\/\/127\.0\.0\.1:\d+\/terminal/)?.[0];if(child.exitCode!==null)throw new Error(errors);await new Promise(r=>setTimeout(r,20));}
 assert.ok(url,'CLI did not start: '+errors);assert.ok(!log.includes(secret));
 client=new WebSocketTransport({url,token:secret});await client.ready();
 await client.request('create',{id:'package-smoke'});let screen='';client.subscribe(event=>{if(event.type==='snapshot')screen=event.snapshot.ansi;});
 await client.request('write',{id:'package-smoke',data:'node -p "6 * 7"\r'});
 const deadline=Date.now()+5000;
 while(!screen.includes('42')&&Date.now()<deadline){await client.request('attach',{id:'package-smoke'});await new Promise(r=>setTimeout(r,25));}
 assert.ok(screen.includes('42'),'Local command output missing');
 await client.request('close',{id:'package-smoke'});client.dispose();client=undefined;
 child.kill('SIGTERM');
 const watchdog=setTimeout(()=>child.kill('SIGKILL'),5000);const code=await exit;clearTimeout(watchdog);assert.equal(code,0);
 console.log('Packaged CLI → WebSocket → real PTY → local Node command: PASS');
} finally {client?.dispose();if(child.exitCode===null){child.kill('SIGTERM');await exit;}}
`,
  );
  console.log(run(process.execPath, ["smoke.mjs"], temporary).trim());
  writeFileSync(
    join(temporary, "index.html"),
    '<html><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  writeFileSync(
    join(temporary, "main.tsx"),
    `import * as React from 'react';
import {createRoot} from 'react-dom/client';
import {TerminalWorkspace,TerminalView} from '@nowly/terminal/react';
import {mountTerminal} from '@nowly/terminal/browser';
import {WebSocketTransport} from '@nowly/terminal/client';
import type {HostOptions} from '@nowly/terminal/server';
import '@nowly/terminal/styles.css';
const options:HostOptions={shellProfile:'clean'};
const transport=new WebSocketTransport({url:'ws://127.0.0.1:5187/terminal',token:'consumer-example'});
void [options,TerminalView,mountTerminal];
createRoot(document.getElementById('root')!).render(<TerminalWorkspace transport={transport}/>);
`,
  );
  writeFileSync(
    join(temporary, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        jsx: "react-jsx",
        strict: true,
        skipLibCheck: false,
        noEmit: true,
        esModuleInterop: true,
      },
      include: ["main.tsx"],
    }),
  );
  run(process.execPath, ["node_modules/typescript/bin/tsc"], temporary);
  run(process.execPath, ["node_modules/vite/bin/vite.js", "build"], temporary);
  const files = readdirSync(join(temporary, "dist/assets"));
  assert.ok(files.some((name) => name.endsWith(".css")));
  console.log("Independent TypeScript + React + CSS production build: PASS");
  const manifest = JSON.parse(
    readFileSync(join(installed, "package.json"), "utf8"),
  );
  assert.equal(manifest.bin["nowly-terminal"], "./dist/cli.js");
  console.log(`Verified package: ${join(root, filename)}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
