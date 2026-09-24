# Persistent terminal daemon implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Native terminal sessions survive Electron application exit and reconnect on restart.
**Architecture:** Renderer IPC → main DaemonClient → private authenticated local socket → detached TerminalHost process → PTY. The package owns launch/discovery/connection; native sample owns UI and app lifecycle.
**Tech Stack:** TypeScript, node:net/fs/child_process, existing node-pty/xterm, Electron/React, Vitest and Playwright.
**Spec:** docs/superpowers/specs/2026-09-24-persistent-daemon-design.md

## Global constraints

- Existing isolated sibling repository and codex branch; no new runtime dependencies.
- ESM Node >=22; native child uses Electron's Node mode and its matching native binary.
- No TCP native listener; private runtime directory and token authentication.
- Ordinary quit disconnects only; explicit stop terminates daemon-owned shells.
- Preserve browser/CLI integration. Version the deliverable 0.1.3. No registry publication.
- Uncertain stale startup lock ownership fails closed with instructions; never kill an unverified PID.

## Review focus

1. Two applications launch at once: converge on one authenticated daemon and preserve original sessions.
2. App disconnect during attach or reload: no leaked listener or dropped snapshot boundary.
3. Dead daemon/invalid metadata/config mismatch: fail clearly or start fresh only when safe; never claim old shell survived.
4. Malformed/auth-failed requests and slow readers: bounded memory and no queued mutation after rejection.
5. Native lifecycle: daemon survives parent quit, explicit stop actually exits PTYs, packaged consumer launches without source imports.

## Task 1 — Packaged daemon and client

Files: new src/daemon/{index,metadata,wire,client,server,entry,launcher}.ts; tests/daemon.test.ts; package exports/build.
Interfaces: ensureTerminalDaemon({runtimeDir,hostOptions?,executablePath?,startupTimeoutMs?}) → Promise<DaemonClient>; connectTerminalDaemon(runtimeDir) → Promise<DaemonClient>. DaemonClient implements TerminalTransport, ready(), dispose(), shutdown(), info(). Info includes daemon PID/instance/protocol, never token in renderer.

- [ ] Add real-process integration tests for persistent session variables/PID/output, concurrent launch, invalid authentication, config mismatch, dead daemon replacement and explicit shutdown. Run and observe missing implementation failure.
- [ ] Implement private runtime metadata and unique short endpoints, bounded newline framing, authenticated global serialized dispatch, detach cleanup, child bootstrap IPC and startup lock. Implement client request/event/status ownership.
- [ ] Run daemon tests, typecheck and existing unit suite; fix failures; commit.

## Task 2 — Native restart integration

Files: examples/electron/main.cjs, terminal-ipc.mjs, preload.cjs if needed, src/ipc-transport.ts, README; tests/electron.spec.ts.
Interfaces: main uses ensureTerminalDaemon with userData/terminal-daemon and process.execPath; bridge consumes TerminalTransport and disconnects on app quit. Main menu can shutdown explicitly; renderer never exposes administrative shutdown/token/config.

- [ ] Change native regression to close/reopen application with the same userData and assert same daemon/shell PID, shell variable, buffered output and normal command execution. Observe failure against old lifecycle.
- [ ] Convert IPC bridge to transport proxy with frame validation and reload fences. Main owns daemon connection only. Add explicit stop-and-quit menu and status propagation. Native fixture verifies hidden launch, rename/split/reload and final process exit.
- [ ] Build actual tarball, install/rebuild isolated sample, run native regression; commit.

## Task 3 — Distribution and final verification

Files: package version and example tarball paths, README/docs/integration/docs/verification, package-verification script as needed.

- [ ] Document normal quit vs stop, architecture, short endpoint/private runtime, stale-lock recovery, config matching, and unsupported OS/daemon restart persistence.
- [ ] Run pnpm check, browser journeys, packaged consumer and standalone native archive verification; inspect native screenshot.
- [ ] Obtain one independent fresh-context whole-change review while checking packaged output. Fix actionable findings with reproduced regressions; no repeated review loop.
- [ ] Commit final source/docs, retain local branch and updated archives; report results and limitations. Existing publication request was completed earlier; do not infer a new release/publication action.
