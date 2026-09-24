# Persistent local terminal daemon

## Intent and scope

The user requests Orca's IPC → independent resident process → PTY architecture. Native applications must launch the terminal service automatically, disconnect without killing shells, and recover the same PID, shell variables, and output on application restart. Keep working in the sibling nowly-terminal repository. The browser/WebSocket integration remains available. This is a local implementation change; no new npm publication or remote deployment is implied.

## Selected architecture

Renderer → sandboxed preload IPC → Electron main's DaemonClient → authenticated local socket → detached daemon owning TerminalHost → node-pty. Unix-domain sockets on POSIX and named pipes on Windows; no TCP port or WebSocket for native integration. Ship daemon entry/client/launcher as `@nowly/terminal/daemon`, with no native module import in the client/main process. Electron launches its own executable with ELECTRON_RUN_AS_NODE and the matching node-pty build.

The alternative of ordinary parent/child IPC alone cannot reconnect after the parent exits, so local sockets are selected by delegated auto-selection. A daemon is scoped to an application's private runtime directory. Host configuration is chosen by trusted main, never renderer. Existing daemons retain their initial configuration; incompatible configuration/protocol returns a clear error instead of terminating running sessions.

## Discovery and launch

A private directory (0700 on POSIX) contains an atomic 0600 descriptor with protocol version, instance ID, daemon PID, endpoint, random token, and configuration digest. Bootstrap configuration crosses the launch-only Node IPC channel rather than a command-line argument or persistent secret-bearing config file. The child disconnects launch IPC after publishing readiness and is detached/unreferenced by its parent.

An exclusive startup lock serializes launchers. Healthy existing descriptors are authenticated and reused. A lock whose ownership cannot safely be established is not deleted automatically: startup times out with a recovery message. The normal launcher releases its own lock in finally. Daemon crashes after successful launch leave no startup lock; the next app launch can replace the dead descriptor and create a fresh daemon. Never kill a PID merely because it appears in a descriptor. A descriptor with a live but unreachable owner fails visibly rather than overwriting it.

Each daemon binds a unique endpoint; short socket paths live in a deterministic private temporary subdirectory to avoid macOS pathname limits. A daemon only removes the descriptor if it still names that instance; socket cleanup is limited to its unique endpoint. No blind unlink of a shared listener address. Concurrent launches converge on one daemon.

## Requests, stream and bounds

Reuse the package's create/list/attach/detach/write/resize/close protocol. Add trusted administrative status/shutdown outside renderer's allowed methods. Auth handshake checks token and protocol before requests. Frame sizes, pending requests, connection count, queued requests and outbound buffer are bounded. Invalid/malformed/authentication-failed connections are closed and queued requests are fenced. Serialize mutations globally in the daemon so concurrent clients cannot race close/create. Snapshot precedes live data on attachment, using the existing ordered headless emulator.

DaemonClient implements TerminalTransport with explicit ready/disconnected/disposed states, bounded request timeouts, rejection of pending calls on disconnect, and listener disposal. dispose disconnects only. shutdown is explicit and ends all PTYs before daemon exit. A renderer IPC bridge validates sender/frame/file URL and permitted methods, fences reloads, and detaches subscriptions without disposing host sessions.

## Lifecycle and user experience

Normal close/quit detaches the app; daemon and shells remain. Reopening the app uses the same runtime directory and persisted layout and reattaches existing sessions. Closing a pane kills its shell. A main-process menu command explicitly ends all terminals and quits. No automatic process restart that pretends a killed shell survived; if daemon/OS exits, shells are not recoverable. On the next launch a dead daemon can be replaced with new sessions. Startup errors retain the existing visible guidance.

## Verification

Failing-first tests cover auth rejection/malformed frames; detached client/reconnect retaining PID/state/output; one daemon from concurrent launchers; stale/dead descriptor restart; configuration mismatch; explicit stop; pending-request rejection. Native hidden tests close and reopen Electron using the same user-data path, verify shell PID/variable/output continuity, run a command, rename/split/reload, and explicitly stop and confirm owned processes exit. The actual package tarball and source archive must work in a fresh consumer. Preserve existing browser/CLI checks. macOS arm64 is executed; Windows/Linux execution remains explicitly unverified.

## Limits

No disk replay after daemon/OS restart, signed installer, multi-user service, SSH, or complete Orca daemon compatibility. The native sample remains single-window. The daemon executes commands with the current user's permissions. Same-user access to the private token grants full terminal control.
