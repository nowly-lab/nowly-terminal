# Native integration implementation plan

> Execute inline with superpowers:executing-plans; final review via requesting-code-review.

**Goal:** Restore shell initialization and ship a working native Electron integration sample.
**Architecture:** TerminalHost stays in Electron main; a narrow preload implements the package transport interface. Normal login shells are the default everywhere.
**Tech stack:** Existing TypeScript, node-pty, React; standalone Electron 43.7.0 sample, Vite and electron-rebuild.
**Spec:** ../specs/2026-09-24-native-integration-design.md

## Global constraints
- Work in nowly-terminal on codex/terminal-toolkit; leave user dotfiles and Orca unchanged.
- Keep Electron dependencies/rebuild isolated in examples/electron.
- No npm publication or signed app release. Do not steal focus during tests.

## Review focus
- Explicit shell args must override profile selection.
- Main must deny foreign renderer/frame requests and malformed parameters.
- Reload must detach observers without killing or duplicating sessions.
- Electron native module must work without damaging Node package consumers.
- UI must display startup/IPC errors and cleanup must release processes.

### Task 1: shell initialization
Files: src/server/shell-profile.ts, src/cli-options.ts, src/cli.ts, examples/react/demo-host.ts, tests/shell-profile.test.ts, tests/cli.test.ts, scripts/verify-package.mjs.
- [ ] Add real zsh fixture: .zprofile extends PATH, .zshrc defines alias; `host.create` default must execute both. Test default CLI user profile and explicit clean.
- [ ] Run tests and observe missing login/clean-default failures.
- [ ] Resolve user args with `['-il']` for POSIX shells and normal profile arguments for Windows; preserve explicit args. Default demo/CLI user, opt-in --clean-shell.
- [ ] Run `pnpm check`; ensure test fixture poll waits for shell prompt before input. Keep personal dotfiles untouched.

### Task 2: standalone Electron integration
Files: examples/electron/{package.json,main.cjs,preload.cjs,terminal-ipc.mjs,src/main.tsx,src/ipc-transport.ts,src/styles.css,index.html,vite.config.ts,README.md}, scripts/setup-electron.mjs, scripts/run-electron.mjs, tests/electron.spec.ts, playwright.electron.config.ts.
- [ ] Write test that launches sample hidden and asserts profile marker, local alias command result, safe preload, split and reload PID stability.
- [ ] Build sample consuming `@nowly/terminal` tarball; isolated npm install and electron-rebuild for node-pty. UI uses package React/CSS exports.
- [ ] Implement main-owned host and serialized IPC: create/list/attach/detach/write/resize/close with validation; fence revoked connections, cleanup subscriptions on reload and dispose host on shutdown.
- [ ] Expose narrow contextBridge object, browser sandbox enabled. Deny navigation/new-window/permission requests.
- [ ] Run native test and inspect screenshot. Launch only this sample; never quit Orca or any unrelated application.

### Task 3: distribution and verification
Files: README.md, docs/integration.md, docs/verification.md, package.json, sample README.
- [ ] Bump package 0.1.2; source sample instructions `pnpm native:setup`, `pnpm native`; package `pnpm test:package` must still pass in normal Node.
- [ ] Document startup correctness vs latency and explicit clean mode. Document Electron setup, ABI rebuild, IPC boundary and app packaging limitations.
- [ ] Request one read-only final review while finishing package checks. Fix confirmed issues and recheck.
- [ ] Build source archive for native example with package tarball; run source-path independent native test. Commit final source and verification evidence.
