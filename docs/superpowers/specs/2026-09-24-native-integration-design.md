# Shell initialization and native Electron integration

## User intent
Restore normal shell initialization, including shell startup files, PATH and aliases, and supply a working native app integration sample like Orca. The prior clean-default demo skipped requested user configuration; initialization correctness takes priority over hiding slow startup.

## Selected design
The existing package remains browser/Node compatible. The library, CLI, Web demo and new Electron demo default to normal interactive login startup for supported POSIX shells; clean startup is explicit only. Explicit executable args still take precedence. zsh and bash use -il, fish uses -il, sh/dash use -il, PowerShell uses -NoLogo without -NoProfile, cmd uses default args. Tests isolate startup files so personal external-tool hooks do not affect deterministic tests. No changes to the user's dotfiles.

Electron sample runs TerminalHost in main and TerminalWorkspace in a sandboxed renderer with nodeIntegration false/contextIsolation true. A preload exposes only terminal request/event methods on fixed channels. Main validates sender and parameters; arbitrary IPC, filesystem APIs, native modules and node-pty never reach the renderer. It denies navigation, new windows and permission requests. No WebSocket port, token or external server is required. A serialized per-window request queue maintains snapshot/event ordering and stale-subscription cleanup on reload. Reload reattaches to existing sessions; app exit kills owned sessions.

Sample is a standalone examples/electron project consuming the actual package tarball, not source-relative imports. Its isolated dependency tree keeps Electron's native-module rebuild away from the library's normal Node build. Package scripts build/install the sample and start it. Sample artifacts are untracked; source/config/README are tracked. Produce updated package 0.1.2 and an installable sample source archive. Do not publish npm or sign/release a native application.

## Verification and errors
Regression tests exercise zprofile/zshrc loading, aliases and PATH with a real login shell, default CLI options and explicit clean mode. CLI package smoke uses clean mode explicitly for determinism while testing default selection separately. Electron uses a controlled home/profile for a hidden integration test: initialization, local command, add/split, renderer reload with same PID, secure preload boundary, and app cleanup. Also launch a hidden smoke with actual user's normal shell profile to confirm real initialization; show a native window only for the final user-facing sample. Report any native-build or OS restriction rather than claiming untested platforms.

Native install/build failures report clear commands; application initialization failures show an error surface. The sample README identifies native ABI requirements and source vs application packaging boundaries. Shell startup may run user-defined external commands and take time; never silently replace it with clean mode.
