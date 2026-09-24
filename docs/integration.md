# Integration guide

## Entry points

| Import | Purpose | Environment |
| --- | --- | --- |
| `@nowly/terminal` | `TerminalTransport`, request/event/session types | Any |
| `@nowly/terminal/client` | `WebSocketTransport` | Browser, Node 22+ |
| `@nowly/terminal/browser` | `mountTerminal`, `TerminalHandle` | Browser DOM |
| `@nowly/terminal/react` | `TerminalView`, `TerminalWorkspace` | React 18+ |
| `@nowly/terminal/server` | `TerminalHost`, `createTerminalServer` | Node + node-pty |
| `@nowly/terminal/styles.css` | Scoped view/workspace styles, imports xterm CSS | CSS-aware bundler |

## Framework-neutral view

```ts
import { WebSocketTransport } from '@nowly/terminal/client';
import { mountTerminal } from '@nowly/terminal/browser';
import '@nowly/terminal/styles.css';

const transport = new WebSocketTransport({ url, token });
const element = document.querySelector<HTMLElement>('#terminal')!;
element.style.cssText = 'position:relative;height:400px';
const terminal = mountTerminal(element, {
  transport,
  sessionId: 'project-shell',
  onState: state => console.log(state),
  onError: error => console.error(error),
  terminalOptions: { fontSize: 14 },
});
terminal.focus();
terminal.findNext('build');
// terminal.paste('echo hello'); uses xterm bracketed paste when enabled.
// terminal.dispose(); detaches the view, does not kill the shell.
// await transport.request('close', { id: 'project-shell' }); explicitly kills.
// transport.dispose(); closes the connection, leaves host sessions running.
```

The container must have nonzero dimensions. React TerminalView supplies its own positioned inner container. `terminalOptions` are read on mount, so remount to change font/theme options. Stable session IDs let remounted views attach to existing sessions. Mount at most one view per session on each transport; a second transport can display the same host session, though dimensions/input are shared between viewers.

`TerminalWorkspace` supplies tab and pane chrome. It accepts `initialLayout` and `onLayoutChange`; persist layout in the host app if required. The demo persists it in localStorage. All panes of a tab use the same orientation; nested mixed split trees are not supported. Closing the last pane leaves an empty workspace with a New tab button. Resizing uses the native bottom-right handle on nonfinal panes. Tab name changes use double click.

## Electron

The runnable `examples/electron` sample uses `TerminalHost` directly in Electron main and `IpcTransport` in the sandboxed renderer. No local server or WebSocket token is required. Run `pnpm native:setup`, then `pnpm native` from the repository root. The standalone source archive includes the library tarball and the sample; see its README for installation.

- `main.cjs` owns the host and window. It fixes shell/cwd in trusted main configuration, denies renderer navigation, new windows and permissions, and disposes the host before app quit.
- `preload.cjs` exposes only terminal `request` / `subscribe` methods on fixed channels, with `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- `terminal-ipc.mjs` checks the exact window, top frame and local renderer URL; validates methods/parameters; serializes requests and fences work across reloads. Reload detaches listeners while preserving PTYs; closing a pane terminates that PTY.
- `src/ipc-transport.ts` implements the existing `TerminalTransport`, so `TerminalWorkspace` and `TerminalView` work unchanged.

This sample binds one window to one host. For multiple windows, route IPC by sender and own subscriptions per window. The trusted terminal renderer is authorized to execute commands as the OS user; never load untrusted content into it. The sample denies external links rather than opening arbitrary protocols.

Electron uses a different native ABI from Node. The sample installs its own dependencies using npm and rebuilds node-pty with `electron-rebuild`; it does not mutate the root Node installation. For a packaged native app, include node-pty's native binary and spawn-helper outside ASAR and preserve executable permissions. This example runs in Electron but does not produce a signed installer.

A separately launched Node server with the WebSocket transport remains supported. Supply a random token and exact allowed origin (`null` only when deliberately using file-origin WebSocket clients). For an existing IPC channel, preserve snapshot-before-live ordering and validate messages on the trusted host. Never import server code into a renderer bundle.

## Host API and ownership

`new TerminalHost({shell,shellProfile,args,cwd,env,scrollback,maxSessions})` defaults to the user's shell (cmd.exe on Windows), home directory, inherited environment, 5000 scrollback lines, 32 sessions. Host options are trusted configuration; remote clients may choose ids/dimensions but cannot override shell/env/cwd. The token already permits arbitrary shell commands, so this is not an execution sandbox.

- `create({id,cols?,rows?})`: returns SessionInfo synchronously. Same id returns the same session, including an exited session, until close removes it.
- `list()`: returns running and retained exited sessions.
- `snapshot(id)`: awaits queued parsing and returns ANSI plus dimensions, sequence, pid and exit state.
- `attach(id,listener)`: sends one authoritative snapshot followed by ordered data/resize/exit/closed events; resolves with a detach function.
- `write(id,data)`, `resize(id,cols,rows)`, `close(id)`, `dispose()` manage sessions. Close/dispose are asynchronous; await them during cleanup.

A view disposal means detach. Server disposal means shell termination. Disconnection is not proof of exit. Reconnect restores the screen from the host and checks output sequences. The host is in-memory; disk replay and process survival after server restart are outside this version.

The serializer preserves the active/alternate screen and supported xterm modes. The copied Orca scanner retains incomplete ANSI tails up to 4096 characters. Larger unterminated escape strings abandon tail tracking, matching the upstream bound. This is not a substitute for Orca's patched xterm capabilities or its full frame/cursor recovery code.

## Wire and trust boundary

`createTerminalServer({token,allowedOrigins,port?,hostname?,hostOptions?})` binds `127.0.0.1` by default. It exposes `/terminal` WebSocket and unauthenticated `/health` liveness only. Origin-present requests require an exact allowed origin; native clients with no Origin still need the token. First frame: `{type:'auth',token}`. Server replies `{type:'ready',version:1}`. Never put a token in a URL.

Requests are `{requestId,method,params}`, responses `{type:'response',requestId,result}` or `{type:'response',requestId,error}`. Methods match the exported Requests type. Terminal events carry `sessionId`; data carries a monotonic `sequence`. Attach replaces that socket's subscription for the id. A snapshot fully replaces the local screen; it is not concatenated with existing output.

The token grants access to every session in that server. Use separate hosts/tokens and proper authorization for different users. For network exposure, deploy behind TLS with application authentication and an appropriate Origin list; this package does not supply multi-user authorization. The known demo token is local development only. Do not expose it publicly.

Input/frame bounds, session caps and slow-consumer disconnects constrain memory but are not per-user quotas. Session dimensions are 2–500 columns and 1–300 rows. Snapshot memory is bounded by the configured scrollback and screen. A disconnected client is restored from a new snapshot rather than replaying an unbounded log.

## Installation

Build and pack before consuming. pnpm must allow node-pty install scripts (`pnpm approve-builds` in a consuming app where required). On macOS the package postinstall restores the published spawn-helper executable bit. If your installer disables lifecycle scripts, run `node node_modules/@nowly/terminal/scripts/prepare-pty.mjs` explicitly. Linux may need a compiler/toolchain for node-pty. Never share a node-pty binary across Node/Electron ABI versions.

## Local command startup

`pnpm dev` starts the localhost UI and PTY server together. Library, CLI and demos all default to `shellProfile: 'user'`. zsh/bash/fish/sh/dash receive `-il` (interactive login); PowerShell loads its normal profile with `-NoLogo`; cmd uses its normal startup. Explicit `args` override these defaults. Unknown shell names use their normal invocation; specify `args` if they require login flags.

Normal configuration supplies login PATH, aliases and shell hooks. Startup may take time if user dotfiles initialize external tools; the package does not silently bypass them. No dotfiles are modified. To deliberately skip configuration use `pnpm dev:clean`, CLI `--profile clean` or `shellProfile: 'clean'`. Clean args are zsh `-f`, bash `--noprofile --norc`, fish `--no-config`, PowerShell `-NoLogo -NoProfile`, cmd `/d`; sh/dash and system files may still initialize. Clean mode is not an isolation boundary.

Browser E2E explicitly uses clean mode on 5196/5197. Native E2E uses normal mode with controlled `.zprofile` and `.zshrc` fixtures to verify PATH/aliases, command input and reload. Vite proxies `/terminal` on the browser demo; the native sample uses IPC only.

## Packaged CLI

The npm package `@nowly/terminal@0.1.2` includes the `nowly-terminal` executable. After installing the local tarball, use `pnpm exec nowly-terminal serve --origin http://localhost:3000 --cwd .` with `TERMINAL_TOKEN` set in the environment. Repeat `--origin` for each exact browser origin; omitted origins allow only origin-less native clients. The server binds loopback and defaults to port 5187. `--port 0` chooses an available port. The token is never printed. `--help` works without loading native PTY dependencies.

The CLI defaults to normal login/interactive startup; `--profile clean` explicitly skips optional startup configuration. `--shell` picks the shell executable. Ctrl+C closes sockets and owned sessions. The CLI is a backend entry point; mount the browser or React exports in the embedding application for the UI.

`pnpm pack` runs a clean build automatically, including declarations and CSS. `pnpm test:package` packs, installs into an isolated temporary project, launches the packaged CLI, runs a real local command through WebSocket/PTY, checks shutdown, type-checks a consumer without skipping dependency declarations, and builds its React/CSS bundle. No npm publication or registry credentials are required.
