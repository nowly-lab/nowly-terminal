# Codex terminal launch and lifecycle events

## Intent and success
The terminal can start the interactive Codex CLI, and embedding applications can observe task/turn start, completion, failure/interruption, tool activity and subagent activity as structured events. Demonstrate a harmless real task delegating one subagent and capture actual lifecycle evidence. Preserve ordinary shell support and the existing persistent native daemon.

## Architecture
Add an optional trusted host-side Codex launch profile. A session-owned adapter launches an isolated Codex app-server on a private short Unix socket, creates a thread and subscribes through JSON-RPC. The existing PTY runs the real Codex TUI via `codex --remote unix://... resume <thread>`. Both the PTY and sidecar belong to the terminal daemon; renderer reload/app quit disconnect only. Closing the terminal explicitly stops both. No TCP listener, modification of user Codex configuration, hook trust bypass, or scraping of unrelated sessions.

The adapter is a separate unit with bounded JSON framing, RPC timeouts, child-exit detection and cleanup on partial startup. Use the existing Codex login and configured model. Launch through the initialized POSIX login shell so the normal PATH works. Windows Codex profile is explicitly unsupported for this revision; shell support remains unchanged.

## Contract
HostOptions gains an opt-in codex configuration (executable/initial prompt and optional CLI settings selected only by trusted host code). The native sample defaults to this profile, with TERMINAL_PROGRAM=shell preserving the earlier shell demo/tests. Browser demo exposes an explicit Codex mode.
TerminalEvent gains an agent event with provider, monotonic per-session sequence, timestamp, session/thread/turn and optional child/tool identity. Snapshot includes a bounded recent-agent-events list so reconnect replays one authoritative window; consumers deduplicate by sessionId+sequence. Event completion means a Codex turn finished, not that the whole terminal process exited. Parent and child completion remain distinct. Unknown protocol events do not fabricate completion. Only normalized lifecycle/tool metadata crosses to the renderer; prompts, raw tool results and credentials are not forwarded.

Use app-server notifications as authoritative data. Track only the root thread and descendants proven by Codex parent/child metadata or collaboration items. Subscribe to known children where necessary and reconcile a child already finished before subscription. Never resume unrelated threads. Expose connection errors as agent errors, not task success. A host-provided initial prompt is submitted only once when a new PTY is created; reconnect must not rerun it.

## UI and embedding
The native example starts Codex and displays a compact activity history beside/below the terminal. The generic package exposes events via existing transport.subscribe; examples show task and child completion handlers. Add a reproducible manual live verification script, isolated fixture directory and a metadata-only captured evidence artifact. The smoke task performs a small calculation/read-only local command, delegates a bounded calculation to one child, waits, then reports the result. No external writes or publishing.

## Verification and scope
Unit tests normalize parent/child events, failures, duplicate notifications and bounded replay. Fake app-server tests exercise RPC framing, lifecycle, failed startup and shutdown without network/model costs. Existing real PTY/browser/native regressions must pass with shell mode explicitly selected. Run an actual Codex TUI with the adapter and a real delegated task; verify received start/subagent/completion events and inspect the UI. Rebuild/version package and native archive after implementation.

App-server is experimental: document the locally verified CLI version and protocol assumptions. No claim of exactly-once durable delivery, OS-reboot resurrection, universal Codex version compatibility, or Windows native verification. Keep work local on the existing isolated sibling repository branch; no new push/registry publication.
