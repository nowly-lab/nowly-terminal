# Nowly Terminal design

## Intent and decisions
Reimplement Orca's end-to-end terminal subsystem as an embeddable toolkit in a sibling of nowly-orca. Other applications should supply a transport and mount a terminal without adopting Orca's stores, Git worktrees or agent infrastructure. The delegated design choice is a TypeScript package with browser, React and Node entry points; this was an automated recommendation, not a personal user review.

## Architecture
One independently buildable package, nowly-terminal, with separately exported protocol, client, browser, React and server modules. Browser modules must never import Node or native dependencies. A TerminalTransport interface supports alternate integrations. The supplied WebSocket transport connects to a standalone Node host, including from Electron's renderer without Node integration. The Node host can also be embedded in an existing process.

The host owns node-pty sessions, stable ids, dimensions, exit state and headless xterm screens. The view owns xterm rendering, search, selection, input and fitting. React exposes TerminalView plus TerminalWorkspace with tabs and horizontal/vertical splits. The framework-neutral mountTerminal API exposes focus, search, paste and disposal. CSS is scoped and themable. UI disposal detaches; explicit session removal kills.

## Data and lifecycle
Create is idempotent for a supplied id and never silently recreates a closed session. Attach sends an authoritative serialized screen and then ordered live events. Snapshot capture and subscription share the host's serialized operation queue, preventing gaps/duplicates. Preserve partial escape sequences across restore and use matching Unicode widths. Keep the process alive across browser reload, transport loss and view remount while the host runs. Retain exited screens until explicit removal. Server restart ends processes: no claim of process survival across host restarts.

Reconnect fetches a new snapshot; uncertain/disconnected is distinct from exited. Bound sessions, input/frame sizes, headless scrollback, queued PTY bytes and socket backlog. A slow client disconnects and restores from the host rather than losing arbitrary ANSI bytes. PTY backpressure pauses/resumes output while the headless parser drains. Errors are explicit protocol responses; pending requests have deadlines and reject on disconnect. Cleanup releases listeners, observers, sockets, timers and owned processes.

## Integration and trust
Default listener is loopback with a required nonempty token and explicit allowed browser origins. WebSocket authentication happens in the first bounded frame with a deadline, not in a URL. Only authenticated clients may create/write/resize/close a shell. A token grants execution as the host user; production deployments must supply their own user authorization and TLS. Shell/cwd defaults and spawning policy belong to the host. Package includes a localhost React demo and documentation for plain browser, React and Electron integration.

## Source mapping
Reference ../orca at f06f24505e: src/main/daemon/terminal-host-session-create.ts (create/attach ownership), headless-emulator.ts (headless snapshot and Unicode parity), terminal-snapshot.ts (snapshot boundary), src/shared/terminal-partial-escape-tail.ts (parser tail), src/renderer/src/lib/pane-manager/pane-lifecycle.ts (addons/disposal), pane-terminal-output-scheduler.ts (bounded writes), and pane-fit-resize-observer.ts (resize lifecycle). Preserve Orca's MIT attribution for transplanted code and record adaptation boundaries.

## Scope
Include real local PTY, interactive shell/TUI rendering, resize, colors, IME through xterm, paste, selection, links, search, tabs, resizable splits, attach/detach, reconnect and screen/scrollback restoration. Support configurable shell/env/cwd on the host. Do not transplant Git, AI launchers, cloud pairing, SSH credential management, custom Orca xterm patches, image protocols or disk checkpoint recovery. These differences must be explicit, not described as full Orca feature parity.

## Verification
Unit and integration tests cover malformed input, auth/origin rejection, real PTY input/resize/exit, idempotence, snapshot/live ordering, reconnect without process duplication, ANSI tail preservation and cleanup. Browser tests use a real host and React demo for typing, resize, remount, tabs/splits, search and reconnect. Build declarations and bundles, check TypeScript and pack/install the artifact into an independent consumer so the sibling Orca repo is not a hidden runtime dependency. macOS validation is local; Linux/Windows portability is implemented but must not be claimed tested without evidence.
