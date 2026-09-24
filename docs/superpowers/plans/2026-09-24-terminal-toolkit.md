# Terminal Toolkit Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver an independent terminal package with real PTY execution, reusable views and reconnection.
**Architecture:** Host owns sessions and serialized screens; transport carries validated requests and ordered events. DOM and React layers depend only on TerminalTransport.
**Tech Stack:** TypeScript, node-pty, xterm/headless/serialize/unicode11, ws, React, Vite, Vitest, Playwright.
**Spec:** ../specs/2026-09-24-terminal-toolkit-design.md

## Global Constraints
- Work only in sibling nowly-terminal; no runtime imports from Orca.
- Keep browser and Node exports separate; preserve MIT attribution.
- Default loopback listener, token authentication and origin allowlist.
- Detach preserves processes; explicit close removes them; host shutdown terminates them.
- Test macOS locally, do not claim Linux/Windows execution evidence.

## Review Focus
- Snapshot boundary must neither repeat nor omit live output: exercise attach during output in host tests.
- React StrictMode/remount must not spawn duplicate shells: stable id and real browser reload test.
- Lost connection is not process exit: disconnect/reconnect test compares PID.
- Malformed frames and hostile origin must never reach spawning: WebSocket rejection tests.
- Native module packaging must work outside workspace: tarball consumer smoke test.

### Task 1: Protocol and host
Files: package.json, tsconfig.json, src/protocol.ts, src/server/session.ts, src/server/host.ts, src/server/index.ts, src/vendor/orca/*, tests/host.test.ts.
Interfaces: TerminalTransport.request(method, params), subscribe(listener), onStatus(listener); TerminalHost.create/attach/write/resize/close/list/dispose.
- [ ] Set up an ESM package with separate declaration exports and Node >=22; pin compatible xterm versions from installed Orca and independently install them.
- [ ] Write tests asserting `expect(host.list()).toHaveLength(1)` after duplicate creates, dimensions after resize, retained exit and missing closed session.
- [ ] Run `pnpm test tests/host.test.ts` and observe missing implementation failure.
- [ ] Implement Session with queued headless writes and host-owned PTY; snapshot = serialize + incomplete escape tail. Attach enqueues snapshot/subscription atomically. Pause PTY above 1 MiB queued output and resume below 256 KiB; reject >8 MiB queued output. Cap sessions at 32.
- [ ] Verify real `/bin/sh` input produces a marker, resize is observable, attach restores history, close kills and dispose empties inventory; commit.

### Task 2: Transport
Files: src/server/websocket.ts, src/client.ts, tests/transport.test.ts.
Interfaces: createTerminalServer({token,allowedOrigins,hostOptions,port}) returns url/host/close; WebSocketTransport implements TerminalTransport.
- [ ] Write failure tests for invalid token/origin/frame and replay after reconnect: `expect(after.pid).toBe(before.pid)`.
- [ ] Run transport tests before implementation.
- [ ] Implement first-frame auth with 5-second timeout, 128 KiB inbound frame limit, request ids and structured errors. Bound socket output to 4 MiB; disconnect slow consumers. Reject unknown methods and validate ids, dimensions and string lengths.
- [ ] Implement reconnect with backoff, request deadlines and rejected pending requests on disconnect; UI reattaches on ready.
- [ ] Run host/transport tests and commit.

### Task 3: Embeddable UI
Files: src/browser.ts, src/react.tsx, src/workspace.tsx, src/styles.css, examples/react/*, tests/browser.spec.ts, playwright.config.ts.
Interfaces: mountTerminal(element,{transport,sessionId}) returns focus/paste/findNext/findPrevious/dispose; TerminalView accepts transport/sessionId; TerminalWorkspace owns tab/split layout with stable session ids.
- [ ] Add browser checks for actual shell echo, search, split/add/close, reload and preserved PID/history.
- [ ] Implement xterm with fit/search/unicode11/web-links, ResizeObserver, bounded serialized writes, replay input suppression and detached lifecycle. Use onStatus to restore on ready, suppress keyboard input until attached.
- [ ] Implement React wrapper and resizable workspace with accessible toolbar, tabs, status and errors. Preserve inactive panes rather than terminating processes. Store layout locally in demo only.
- [ ] Run `pnpm build`, `pnpm typecheck`, `pnpm test:e2e`; inspect screenshot and fix verified defects.
- [ ] Commit working UI and example.

### Task 4: Distribution and final review
Files: README.md, THIRD_PARTY_NOTICES.md, LICENSE, docs/integration.md.
- [ ] Document plain DOM, React and Electron renderer usage, token trust boundary, scripts, platform limits and feature migration map.
- [ ] Run `pnpm check` and `pnpm pack`; install tarball in a temporary independent project and import server/client exports and CSS.
- [ ] Review actual code for attach races, process leaks, effect cleanup and packaging omissions; fix and recheck affected behavior.
- [ ] Commit documentation and verification evidence. Report location, usage and material limitations.
