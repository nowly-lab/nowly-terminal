# Integration guide

## Entry points

| Import | Purpose | Environment |
| --- | --- | --- |
| `@nowly/terminal` | `TerminalTransport`, request/event/session types | Any |
| `@nowly/terminal/client` | `WebSocketTransport` | Browser, Node 22+ |
| `@nowly/terminal/browser` | `mountTerminal`, `TerminalHandle` | Browser DOM |
| `@nowly/terminal/react` | `TerminalView`, `TerminalWorkspace` | React 18+ |
| `@nowly/terminal/daemon` | Persistent daemon launcher/client | Trusted Node/Electron main |
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

## Electron and resident daemon

The native sample automatically starts or reconnects to a detached daemon owning TerminalHost:

```text
React -> sandboxed preload IPC -> Electron main / DaemonClient
                                     | local socket
                              independent daemon -> PTY -> shell
```

Native integration opens no TCP listener. Shell mode uses only native IPC and the daemon socket; Codex mode additionally uses a private Unix WebSocket proxy. Run `pnpm native:setup`, then `pnpm native`. Normal quit disconnects only; reopening restores the same shell PID, variables and output, including output generated while the UI was closed. Closing a pane terminates its shell. The main-process Stop all terminals menu explicitly stops the daemon and every shell. The sample persists its layout in userData.

The IPC bridge validates sender/window/top-frame/file URL, permits only public terminal methods and fences reloads. The preload exposes request/subscribe/onStatus, never credentials or daemon administration. nodeIntegration stays false, contextIsolation and sandbox stay true. Neither the renderer nor the main-process daemon client imports node-pty.

### Daemon API

```ts
import { ensureTerminalDaemon, connectTerminalDaemon } from '@nowly/terminal/daemon';
const transport = await ensureTerminalDaemon({
  runtimeDir: '/private/application-data/terminal-daemon',
  hostOptions: { cwd: projectDirectory },
  // In Electron main: executablePath: process.execPath
});
await transport.request('create', { id: 'shell-1' });
transport.dispose(); // disconnect only; daemon and PTYs remain
const connection = await connectTerminalDaemon('/private/application-data/terminal-daemon');
console.log(connection.info()); // version, daemon PID, instance ID; no token
await connection.shutdown();   // explicit service + all-shell shutdown
connection.dispose();
```

Concurrent ensure calls converge on one daemon. connect only attaches and never launches. Existing instances preserve original host configuration/environment; explicit configuration differences are rejected until you stop the old instance or choose another runtime directory. `entryPath` can locate an unpacked daemon entry; `startupTimeoutMs` defaults to 10000. A disconnected client rejects pending calls; call ensure/connect again for a new connection. Dead daemon replacement starts fresh shells, not recovered old processes.

### Runtime ownership and recovery

Use a private per-user directory (0700 on POSIX). The 0600 descriptor contains the local token: never log it or expose it to a renderer. Unix sockets use a short private temporary subdirectory, avoiding macOS pathname limits; Windows uses named pipes plus token authentication. Each daemon binds a unique endpoint and removes only its own descriptor. Windows/Linux execution remains unverified.

Live-but-unreachable daemons and incompatible configuration/metadata fail visibly rather than killing/replacing sessions. `launch.lock` normally disappears after startup; a launcher crash during startup can leave it behind. Verify no launcher is active, move the reported lock aside and retry. The library never blindly clears uncertain ownership or kills an unverified PID.

The sample remains single-window. Multi-window apps must route subscriptions by sender. Terminal renderers execute commands as the OS user: never load untrusted content into them. Native child launch requires Electron's RunAsNode fuse enabled and node-pty rebuilt for that executable. Keep `dist/daemon/entry.js`, native binaries and spawn-helper outside ASAR, and preserve executable permissions. The independent npm installation avoids overwriting the root Node native binary. Signed installers, OS services and disk replay after daemon/OS death are outside this sample.

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

The npm package `@nowly/terminal@0.2.1` includes the `nowly-terminal` executable. After installing the local tarball, use `pnpm exec nowly-terminal serve --origin http://localhost:3000 --cwd .` with `TERMINAL_TOKEN` set in the environment. Repeat `--origin` for each exact browser origin; omitted origins allow only origin-less native clients. The server binds loopback and defaults to port 5187. `--port 0` chooses an available port. The token is never printed. `--help` works without loading native PTY dependencies.

The CLI defaults to normal login/interactive startup; `--profile clean` explicitly skips optional startup configuration. `--shell` picks the shell executable. Ctrl+C closes sockets and owned sessions. The CLI is a backend entry point; mount the browser or React exports in the embedding application for the UI.

`pnpm pack` runs a clean build automatically, including declarations and CSS. `pnpm test:package` packs, installs into an isolated temporary project, launches the packaged CLI, runs a real local command through WebSocket/PTY, checks shutdown, type-checks a consumer without skipping dependency declarations, and builds its React/CSS bundle. No npm publication or registry credentials are required.

## Codex terminal profile and events

Use Codex CLI installed on the host and its existing login. Verified with codex-cli 0.155.1 on macOS arm64. The [official app-server protocol](https://learn.chatgpt.com/docs/app-server) is experimental. The optional profile currently requires POSIX Unix sockets; Windows Codex embedding is not implemented. No additional runtime dependency is required.

```ts
const transport = await ensureTerminalDaemon({
  runtimeDir: '/absolute/app-data/codex-terminal-daemon',
  executablePath: process.execPath, // Electron main
  hostOptions: {
    cwd: '/absolute/project',
    codex: {
      executable: 'codex', // resolved using the initialized shell PATH
      // prompt: 'Summarize this directory without editing files.',
      // sandbox: 'read-only', approvalPolicy: 'on-request',
    },
  },
});
transport.subscribe(event => {
  if (event.type === 'agent') {
    if (event.kind === 'task.completed') console.log('Task done', event.threadId, event.turnId);
    if (event.kind === 'subagent.completed') console.log('Child done', event.threadId, event.parentThreadId);
  }
  if (event.type === 'snapshot') {
    console.log('Recent events', event.snapshot.agentEvents ?? []);
  }
});
await transport.request('create', {id: 'coding'});
await transport.request('attach', {id: 'coding'});
```

The existing native IPC bridge forwards these events; no new renderer privilege is needed. In React, add `<AgentActivity transport={transport} />` from `@nowly/terminal/react` beside `TerminalWorkspace`. A renderer must attach to the session (TerminalWorkspace already does this) to receive its live events.

HostOptions.codex accepts executable, args (trusted CLI configuration arguments), optional initial prompt, sandbox (read-only/workspace-write), approvalPolicy (on-request/never), and startupTimeoutMs. Arguments are individually quoted; they are not renderer-controlled shell snippets. The optional initial prompt runs once when a new session is created, never on attach/reload. Omit sandbox/approvalPolicy to keep the user's Codex settings. This integration does not approve requests or alter hook trust; normal Codex prompts remain in the TUI.

Architecture: renderer → existing IPC → terminal daemon → PTY → real Codex TUI. The TUI communicates through a private0700 Unix socket directory (socket0600); a transparent WebSocket-to-stdio proxy connects its dedicated Codex app-server. No TCP listener is opened. Codex creates its own thread; the adapter does not attempt to resume an empty pre-created thread. Login initialization output is separated from JSON protocol stdout. Explicit terminal close stops the sidecar process group; ordinary renderer/app disconnect leaves it running with the PTY.

Each agent event contains provider=codex, sessionId, sequence, timestamp, kind and threadId (empty before initialization failure), with optional parentThreadId, turnId, itemId, tool and status. Kinds: session.started; task.started/completed/failed/interrupted; subagent.spawned/started/completed/failed/interrupted; tool.started/completed; connection.failed. Completion means a Codex turn completed, independently of PTY exit. Tool completion carries status and does not automatically mean success. Only descendants proven by Codex thread metadata/collaboration events are included. Unrecognized notifications never imply completion.

The daemon stores the most recent200 agent events per terminal. On snapshot, replace that terminal's replay window and deduplicate live events by sessionId+sequence. Sequence is independent of terminal output sequence and resets with a new terminal instance. This is an in-memory bounded event feed, not a durable exactly-once queue. Persist the events in your application if a full audit history is required. Prompt, raw tool result, plugin definition and credential fields are not selected from the protocol; the final assistant reply itself may contain user data. The TUI necessarily receives its normal protocol content. Backend frames are bounded at64MiB to accommodate large Codex plugin catalogs; event metadata remains small.

Version0.2.0 changes direct `TerminalHost.create` to return Promise<SessionInfo>. Await it before writing, attaching or inspecting sessions. The transport API was already asynchronous and is unchanged. `pnpm test:codex` explicitly runs a real read-only model task with one delegated child; it is not part of the normal unit test suite. `NOWLY_LIVE_CODEX=1 pnpm test:native --grep 'live Codex'` verifies the actual native UI.

Codex mode is verified with zsh (normal user initialization) and a controlled bash initialization fixture. Use zsh/bash for the native sample. macOS `/bin/sh -il` in the verified environment closes inherited protocol file descriptors and is not supported for Codex mode; startup scripts must preserve inherited descriptors. This limitation does not affect shell-only mode.

Thread switching preserves the per-terminal event sequence and the last 200 events. Ownership tracking is capped at 128 threads; extra children beyond that bound are ignored. When a new root needs capacity, the oldest ownership subtree is evicted together. This event feed is a bounded activity view, not an audit log.

### Final assistant replies (0.2.1)

Successful `task.completed` and `subagent.completed` events include optional `finalMessage: string` and `finalMessageTruncated: boolean`. The text is also retained in snapshot replay. Final replies can contain user data; event consumers should treat the text like the original Codex reply.

`item/completed` assistant messages and `turn/completed` items supply the last final answer for the same thread and turn. Explicit `phase: final_answer` takes precedence; phase-less legacy messages are used only when no explicit final exists. Commentary, reasoning, prompts and tool output are excluded. Child collaboration completion can supply its final message when turn notifications were missed. If no final reply is available, the fields are omitted; failed/interrupted events do not contain a successful final reply.

Each message is limited to 8 KiB of UTF-8 without splitting a Unicode character. `finalMessageTruncated` is true when clipped. Existing 200-event replay and 128-thread tracking bounds still apply. This supersedes the metadata-only completion event format in 0.2.0.

```ts
transport.subscribe(event => {
  if (event.type === "agent" && event.kind === "task.completed") {
    console.log(event.finalMessage); // e.g. "CODEX_CAPTURE_OK 42"
  }
});
```

After updating, explicitly stop the old daemon using the sample's Stop all terminals menu before restarting. A normal window reload reconnects to the existing process and does not load a new daemon version.
