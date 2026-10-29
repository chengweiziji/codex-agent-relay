# Configuration and operation

## Project configuration

Run `node src/cli.ts setup` or use the plugin Setup action to open the first-time settings page. It accepts the project and Harness locations, a user-selected provider/model, threshold and credential environment-variable name. Saving does not register a task or call a model. Configured projects are kept in a local project index so their model settings are available before the first chat task.

The nearest ancestor `.agent-relay.json` is used, starting at the session cwd. Real paths are resolved; Windows directory identity is case-insensitive. Different worktrees/cwds have separate execution ownership.

| Field | Meaning |
|---|---|
| `version` | `1` |
| `enabled` | Explicit project opt-in |
| `agent` | Installed adapter ID; first-party adapter is `deepseek-harness` |
| `provider` / `model` | Exact target route, validated by the receiver |
| `thresholdPercent` | Remaining-percent threshold, >0 and ≤50; default 5 |
| `quotaBucket` | Codex metered limit ID, default `codex`; choose the bucket applicable to the task/model |

Project config carries no command or credential. Unknown fields are rejected. Configuration is snapshotted into each dispatched job; later changes cannot change its model.

## User configuration

Default relay home: `~/.codex-agent-relay`; override with `AGENT_RELAY_HOME`. It stores `user.json`, the private service endpoint/token, state and event logs. Protect this directory as local task data. Share neither dashboard capability URLs nor the state directory.

`user.json` accepts `codex`, `agents`, and optional `adapterModules`. Each launch has `command`, an argument array, optional nonsecret `env` and `envFrom` environment-variable references. Arguments are passed with `shell: false`. Prefer a real executable (`node` plus the installed DSH JS CLI) on Windows instead of a `.cmd` wrapper. No shell command construction is used for Agent prompts.

The shipped DSH adapter uses the documented stdio JSON-RPC SDK profile directly: `initialize`, `session/prompt`, `session.event`, `session.status`. It does not depend on an undocumented web endpoint or control the Agent's GUI. The receiver writes its own durable session history under its configured Harness home. Configure an appropriate Harness sandbox/profile; this relay never selects `sdk-minimal` or grants full-access flags for convenience.

The service and receiver inherit process environment at startup. Configure credentials in the environment that launches Codex/the service, or through supported Harness credentials. Do not place actual secrets in `env`, scripts or committed files. Redaction is defense in depth, not a guarantee that arbitrary task text contains no secrets.

## Lifecycle

Tasks: `active → handed_off` or `completed`; `paused`, `waiting_user`, and `handoff_failed` are explicit non-dispatch states. Stops/interrupts pause undispatched work. The user must authorize continuation; the skill can then set it active.

Jobs: `preparing → accepted/running → ended | waiting_user | failed | cancelled`. The SDK may send a running notification before its receipt, so events are persisted in arrival order without treating running as accepted. A final result can self-report completion, but only an explicit evidence-bearing verification changes the verification label.

A failed or uncertain job is never automatically retried. On service restart, previously live jobs get a recovery fence. Inspect the former runtime and any spawned background jobs, then acknowledge with:

```sh
node src/cli.ts recover --job JOB_ID --evidence "Checked the recorded runtime and workspace: no previous writer remains"
```

This releases the directory fence; it does not resend the task, change files, or assert task completion. Source tasks that were dispatched remain fenced. Continue intentionally in a new task after reviewing the result.

Quota-only monitoring does not make model calls. The relay uses one selected Codex authentication/configuration per instance. New account contexts require a separate home/service or a controlled service restart; there is no multi-account auto-discovery.

## MCP tools

`relay_setup`, `relay_register`, `relay_checkpoint`, `relay_handoff`, `relay_status`, `relay_finish`, `relay_task_state`, `relay_verify`. `relay_setup` only returns a local settings URL; the user chooses the target in that page.

Use the task `id` returned by registration for mutations. The registered Codex `sessionId` comes from the actual hook event, not a guessed chat name. `relay_handoff` takes a task ID and final instruction text; only Codex's explicit tool call dispatches. Repeated calls return the persisted job. `relay_status` is read-only.

`relay_checkpoint.backgroundToolIds` is only for intentionally continuing background jobs whose IDs and observed status are recorded in `processes`. It clears those specific pending hook operations; it does not stop the job. Never use it to skip an active file write.

## HTTP and display

The server binds only `127.0.0.1` on an ephemeral port. Authenticated JSON requests use `POST /api/<action>`. Event streaming uses `GET /events?job=<id>&after=<seq>` with a Bearer header and persisted sequence IDs. The dashboard gets its capability from a URL fragment, clears that fragment, and stores the capability in session storage. No CORS allowance or external script dependency is used.

Opening a panel is a host tool action performed by the skill before source inference stops. The local service cannot autonomously open or modify Codex's UI. Refreshing the existing panel needs no model.
