# Codex Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Launch the real Codex TUI in the terminal and deliver root/task/subagent lifecycle events to embedding applications.
**Architecture:** One private Unix app-server sidecar per Codex terminal, supervised by TerminalHost in the resident daemon. JSON-RPC events are normalized and carried by TerminalEvent and bounded snapshot replay; the PTY displays the standard remote Codex TUI.
**Tech Stack:** TypeScript, Node child_process/net, node-pty, React, Vitest, Playwright Electron; installed Codex CLI 0.155.1.
**Spec:** docs/superpowers/specs/2026-09-24-codex-events-design.md

## Global constraints
- Preserve shell and persistent-daemon behavior; no TCP for native Codex.
- No user configuration changes, hook trust bypass, unrelated thread reads, or new publication.
- Real model smoke is read-only and delegates one bounded child calculation.
- Experimental Codex protocol version and macOS-only verification stated explicitly.
- Host.create becomes async to prepare Codex before spawning PTY; release as 0.2.0 and migrate every caller.

## Review focus
1. Concurrent creates/close/dispose during startup must not orphan sidecars or exceed limits.
2. Partial JSON, unknown events, duplicate notifications and fast-finishing children must not invent or duplicate success.
3. Reload/reconnect must restore bounded event history without repeating initial prompt.
4. Paths with spaces/quotes and normal login PATH must launch correctly without shell injection.
5. Sidecar exit/timeout and task failure must be visible; explicit close must terminate owned processes.

## Task 1: Event contract and normalizer
Files: src/codex/events.ts; src/protocol.ts; tests/codex-events.test.ts.
Interfaces: AgentEvent is a TerminalEvent with `type: 'agent'`, provider codex, kind, timestamp, sequence, sessionId, threadId, optional turnId/agentId/tool/status. CodexEvents accepts a root thread, normalizes notifications and owns bounded replay plus known-child tracking.
- [ ] Add failing normalization tests for parent start/completed/failed/interrupted, child ownership/completion, duplicate items, unknown methods and history cap.
```ts
expect(events.accept('turn/completed', {threadId: root, turn: {id: 't', status: 'failed'}})[0].kind).toBe('task.failed');
```
- [ ] Implement normalizer with allowlisted metadata only, monotonic sequence and snapshot history capped at 200 events.
- [ ] Run targeted Vitest tests; commit contract and normalizer.

## Task 2: Sidecar and PTY lifecycle
Files: src/codex/rpc.ts, src/codex/runtime.ts; src/server/{host,session}.ts; src/daemon/{server,client}.ts; src/{client,protocol}.ts; tests/codex-runtime.test.ts and existing host tests; tests/fixtures/codex-server.mjs.
Interfaces: startCodexRuntime(options, spawnOptions, emit) resolves threadId, PTY command/args and dispose(). HostOptions.codex selects executable/prompt/config, trusted only. Host.create returns Promise<SessionInfo>, deduplicates pending creation, and disposes in-flight startup before shutdown succeeds.
- [ ] Add failing tests using a deterministic fake executable: fragmented RPC response, failed initialize, oversized frame, child exit, duplicate create and failed PTY launch cleanup.
```ts
const [a,b] = await Promise.all([host.create({id:'one'}),host.create({id:'one'})]);
expect(a.pid).toBe(b.pid);
await host.dispose();
```
- [ ] Launch app-server through POSIX login shell (`exec` plus individually shell-quoted arguments), private short0700 socket directory, max frame8MiB, pending32, request timeout15s. Initialize then thread/start. PTY execs Codex remote resume with optional initial prompt; no auto-approval flags. Subscriptions only proven descendant threads; reconcile completed child on resume where required. Dispose rejects pending RPC and stops owned child with bounded SIGTERM/SIGKILL.
- [ ] Session retains lifecycle events and snapshot replay; runtime cleanup is tied to PTY exit/explicit close. Migrate Host.create callers, preserve transport channels, forward agent frames.
- [ ] Run typecheck/full unit suite and a temporary real TUI connection probe; commit.

## Task 3: Examples and actual delegated task capture
Files: examples/electron/{main.cjs,src/main.tsx,src/styles.css}; examples/react/{demo-host,main}.tsx/ts; scripts/verify-codex.mjs; tests/electron.spec.ts; tests/codex.electron.spec.ts; docs/evidence/codex-events.json.
- [ ] Select shell mode explicitly in existing native tests. Add UI fixture test for event replay/history; confirm failing before UI implementation.
- [ ] Default native to Codex with separate mode-specific runtimeDir/layout; browser opts in with TERMINAL_PROGRAM=codex. Add bounded event list; subscribe and deduplicate live and snapshot events.
```ts
transport.subscribe(event => { if(event.type === 'agent') add(event); if(event.type === 'snapshot') merge(event.snapshot.agentEvents ?? []); });
```
- [ ] Run actual Codex read-only smoke with one child, capture normalized metadata only, await task.completed and subagent completion; inspect screenshot and verify local command evidence. Fail visibly if auth/model/protocol unavailable, never synthesize results.
- [ ] Commit sample, script and evidence.

## Task 4: Distribution and final review
Files: package.json, native example dependency/lock, README/docs/integration.md/docs/verification.md.
- [ ] Bump0.2.0; document async create, Codex options, event mapping, replay window, native launch and limitations with official app-server documentation link.
- [ ] Run typecheck/unit, browser, isolated packaged consumer and native archive verification sequentially where builds/test artifacts collide.
- [ ] One independent whole-change review under executing-plans; reproduce/fix actionable findings and recheck affected tests once.
- [ ] Commit final docs/source and keep branch local; clean only this plan ledger after durable verification record.
