# Verification — 2026-09-24

Environment: macOS arm64. All checks below were run locally on the final source changes.

- `pnpm check`: TypeScript and build pass; 14 tests across host, transport, restoration and shell profile pass.
- `pnpm test:e2e`: two Chromium journeys pass against real node-pty shells: shell input, search controls, tab creation/switching, split/close, reload, reconnect preserving PID, resize; three panes remain within the workspace and can all be closed.
- `pnpm exec vite build --config examples/react/vite.config.ts`: demo production bundle builds. xterm makes the bundle exceed Vite's default 500 kB warning threshold; this is a size warning, not a build failure.
- `pnpm pack`: package includes separated browser/client/React/server exports, declarations, CSS, notices, integration documentation and native helper postinstall.
- Installed final tarball into a new canonical temporary directory using npm, with no Orca source imports. Actual packaged server/client shell round trip passes; CSS resolves. A separate React app importing only package exports builds with Vite.
- Fresh consumer `npm audit --omit=dev`: 0 vulnerabilities after updating ws to 8.21.3. An earlier reused temp directory retained stale lock entries; the fresh consumer is the final dependency evidence.

Read-only independent review identified incomplete cursor/charset restoration, queued mutations after rejection, and third-pane clipping. All three were reproduced and fixed. Regression cases cover scroll-region cursor position, saved cursor position, DEC line drawing, rejected-frame burst fencing, and three split panes. Binary mouse input additionally preserves byte 0x80 in a real PTY test.

![Verified terminal workspace](media/terminal-workspace.png)

Limits: Linux/Windows and Electron packaged runtime have not been executed here. The demo E2E uses the real default shell with its clean profile to avoid dependencies on personal startup plugins. Host restart persistence, full Orca native daemon recovery, saved SGR/charset register fidelity, and exhaustive TUI protocol compatibility are not claimed. Clipboard requests are limited to 64 KiB UTF-16 code units per write and wire frames to 128 KiB. Disk persistence, SSH management and image protocols remain outside this version.

## Local command follow-up

The user's actual demo showed an empty terminal while user shell initialization ran external tools. The default demo now skips optional startup profiles, preserves inherited PATH, and starts UI + PTY host using one `pnpm dev`. The library retains user-profile behavior by default and exposes the opt-in `shellProfile` setting.

A failing regression test first reproduced `.zshrc` delaying the prompt; with clean startup it passes and executes local `node` and `pwd`. All 14 tests and both Chromium journeys pass. The updated in-app browser was reloaded and `pwd; node --version; printf "LOCAL_COMMAND_OK\\n"` was typed through the terminal UI: output showed the nowly-terminal directory, Node v26.3.1 and LOCAL_COMMAND_OK. The demo remains running on port 5186.

## Distribution package 0.1.1

`@nowly/terminal@0.1.1` includes the `nowly-terminal serve` CLI, browser/React/server entry points, CSS and declarations. `prepack` rebuilds from a clean dist directory. Source checkout demos and tests are excluded from the archive.

- `pnpm check`: 17 tests pass; typecheck and clean build pass.
- `pnpm test:package`: automatic pack/build, isolated installation, packaged CLI startup, real local Node command through WebSocket/PTY, graceful shutdown, strict consumer TypeScript validation, and React/CSS production build all pass.
- CLI auth comes from `TERMINAL_TOKEN`; no token is printed. Invalid ports, origins, profile names, unknown and missing options are covered by tests.
- Artifact: `nowly-terminal-0.1.1.tgz`. npm registry publication was not performed.

## Shell initialization and native sample — 0.1.2

This revision supersedes the earlier clean-default workaround: library, CLI, browser demo and native sample now use the normal user profile. Supported POSIX shells start with `-il`; `.zprofile` PATH and `.zshrc` aliases are verified together. Clean mode is explicit only (`pnpm dev:clean` / `--profile clean`). User dotfiles are untouched.

- `pnpm check`: 18 tests, typecheck and build pass.
- `pnpm native:setup`: installs the actual 0.1.2 tarball into an isolated npm project, rebuilds node-pty for Electron 43.7.0, and builds the renderer successfully.
- `pnpm test:native`: hidden macOS arm64 Electron window passes login PATH/alias initialization, real keyboard command execution, renderer isolation, invalid IPC rejection, split, reload with the same PID/output, pane close and PTY exit after app quit.
- The native renderer uses fixed-channel preload IPC, not a WebSocket server. Main validates sender/top frame/file URL and owns lifecycle. The example imports package exports only.

![Verified native terminal](media/native-terminal.png)

This is a runnable Electron source example, not a signed application installer. Linux/Windows native execution remains unverified.
