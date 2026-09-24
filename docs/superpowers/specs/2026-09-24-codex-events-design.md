# Codex terminal launch and lifecycle events

## Intent and success
The terminal can start the interactive Codex CLI, and embedding applications can observe task/turn start, completion, failure/interruption, tool activity and subagent activity as structured events. Demonstrate a harmless real task delegating one subagent and capture actual lifecycle evidence. Preserve ordinary shell support and the existing persistent native daemon.

## Architecture
Add an optional trusted host-side Codex launch profile. A session-owned adapter launches an isolated Codex app-server over stdio and bridges it transparently to a private short Unix WebSocket endpoint. The existing PTY runs the real Codex TUI via `codex --remote unix://...`; the TUI owns initialization, thread creation and approval responses. The adapter observes backend notifications without changing them. Both the PTY and sidecar belong to the terminal daemon; renderer reload/app quit disconnect only. Closing the terminal explicitly stops both. No TCP listener, modification of user Codex configuration, hook trust bypass, or scraping of unrelated sessions.

The adapter is a separate unit with bounded JSON framing, startup timeout, child-exit detection and cleanup on partial startup. Use the existing Codex login and configured model. Launch through the initialized POSIX login shell so the normal PATH works. Windows Codex profile is explicitly unsupported for this revision; shell support remains unchanged.

## Contract
HostOptions gains an opt-in codex configuration (executable/initial prompt and optional CLI settings selected only by trusted host code). The native sample defaults to this profile, with TERMINAL_PROGRAM=shell preserving the earlier shell demo/tests. Browser demo exposes an explicit Codex mode.
TerminalEvent gains an agent event with provider, monotonic per-session sequence, timestamp, session/thread/turn and optional child/tool identity. Snapshot includes a bounded recent-agent-events list so reconnect replays one authoritative window; consumers deduplicate by sessionId+sequence. Event completion means a Codex turn finished, not that the whole terminal process exited. Parent and child completion remain distinct. Unknown protocol events do not fabricate completion. Only normalized lifecycle/tool metadata crosses to the renderer; prompts, raw tool results and credentials are not forwarded.

Use app-server notifications as authoritative data. Track only the root thread and descendants proven by Codex parent/child metadata or collaboration items. The parent TUI stream includes child lifecycle notifications; collaboration completion states provide a fallback when needed. Never resume or read unrelated threads. Expose connection errors as agent errors, not task success. A host-provided initial prompt is submitted only once when a new PTY is created; reconnect must not rerun it.

## UI and embedding
The native example starts Codex and displays a compact activity history beside/below the terminal. The generic package exposes events via existing transport.subscribe; examples show task and child completion handlers. Add a reproducible manual live verification script, isolated fixture directory and a metadata-only captured evidence artifact. The smoke task performs a small calculation/read-only local command, delegates a bounded calculation to one child, waits, then reports the result. No external writes or publishing.

## Verification and scope
Unit tests normalize parent/child events, failures, duplicate notifications and bounded replay. Fake app-server tests exercise protocol framing, lifecycle, failed startup and shutdown without network/model costs. Existing real PTY/browser/native regressions must pass with shell mode explicitly selected. Run an actual Codex TUI with the adapter and a real delegated task; verify received start/subagent/completion events and inspect the UI. Rebuild/version package and native archive after implementation.

App-server is experimental: document the locally verified CLI version and protocol assumptions. No claim of exactly-once durable delivery, OS-reboot resurrection, universal Codex version compatibility, or Windows native verification. Keep work local on the existing isolated sibling repository branch; no new push/registry publication.

## Verified implementation rulings

The installed CLI0.155.1 refuses to resume a newly created empty thread, even while thread/loaded/list includes it. A two-client probe and actual TUI reproduced this. Delegated routine choice selected the transparent gateway described above. Codex Unix transport itself uses WebSocket frames; there is no TCP listener. A real plugin/list response exceeds8MiB, so the backend framing bound is64MiB with incremental chunk collection. Input remains8MiB and lifecycle metadata stays bounded/small. Shell profile control output is redirected away from protocol stdout while preserving initialized PATH.

Final verification constraints: TUI roots are registered only from successful responses to this TUI's own start/resume/fork requests; internal Codex threads are not user tasks. Root switching retains the terminal event sequence and replay window. Ownership is bounded at 128 threads, with subtree eviction when a new root needs capacity and ignored extra children beyond capacity. Codex profile supports zsh/bash startup that preserves inherited descriptors; macOS sh -il is excluded based on an actual failed descriptor probe.

Codex TUI also creates a temporary thread with threadSource=system to generate a title. A metadata-only request trace confirmed this. System threads are excluded even when requested by the TUI; only user thread lifecycle is projected. The matching regression failed before the filter and now guards the completion boundary.
