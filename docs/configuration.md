# Configuration and operation

## Project configuration

Run `node src/cli.ts setup` or use the plugin Setup action to open the first-time settings page. It accepts the project and Harness locations, a user-selected provider/model, threshold and credential environment-variable name. Saving requires an explicit confirmation of the data disclosure; it does not register a task or call a model. Configured projects are kept in a local project index so their model settings are available before the first chat task. Handoff also requires a local secret scanner, `gitleaks` by default; configure `scanner` in `user.json` to use a reviewed alternative.

Approval is stored in `<relay-home>/trusted-projects.json`, keyed by a hash of the canonical project path. Each record contains the approved configuration, a configuration fingerprint and a launch fingerprint covering the selected Agent launch, adapter module and scanner. A repository or parent-directory `.agent-relay.json` is not trusted and is ignored; nested directories do not inherit an enabled project. Real paths are resolved and Windows directory identity is case-insensitive. Different worktrees/cwds have separate execution ownership. Editing a launch, adapter module or scanner in `user.json` revokes the project approval until the configuration is explicitly saved again.

| Field | Meaning |
|---|---|
| `version` | `1` |
| `enabled` | Explicit project opt-in |
| `agent` | Installed adapter ID; first-party adapter is `deepseek-harness` |
| `provider` / `model` | Exact target route, validated by the receiver |
| `thresholdPercent` | Remaining-percent threshold, >0 and ≤50; default 5 |
| `quotaBucket` | Codex metered limit ID, default `codex`; choose the bucket applicable to the task/model |

Project config carries no command or credential. Unknown fields are rejected. Configuration is snapshotted into each dispatched job; later changes cannot change its model.

If an approval is revoked, the settings page clears the prior target and requires a fresh selection; it never reuses another project's fields. Saving is disabled while loading, and a late response for a previously selected project is ignored.

## User configuration

Default relay home: `~/.codex-agent-relay`; override with `AGENT_RELAY_HOME`. It stores `user.json`, project approval records, the private service endpoint/token, state and event logs. Protect this directory as local task data. Share neither dashboard capability URLs nor the state directory.

`user.json` accepts `codex`, `agents`, optional `adapterModules`, optional `scanner` and `retentionDays`. Each launch has `command`, an argument array, optional nonsecret `env` and `envFrom` environment-variable references. Arguments are passed with `shell: false`. Prefer a real executable (`node` plus the installed DSH JS CLI) on Windows instead of a `.cmd` wrapper. No shell command construction is used for Agent prompts.

Receivers do not inherit the full service environment. They get a fixed allowlist of runtime variables (`PATH`, `SYSTEMROOT`, `WINDIR`, `COMSPEC`, `PATHEXT`, `TEMP`, `TMP`, `TMPDIR`, `LANG`, `LC_ALL`, proxy variables), explicit `env` entries and `envFrom` references. Injection variables (`NODE_OPTIONS`, `NODE_PATH`, `LD_*`, `DYLD_*`, `PYTHONPATH`) are rejected. `HOME` and `USERPROFILE` are not inherited by receivers by default; set an explicit non-secret path in that launch's `env` if the receiver needs one. See [security and data handling](security.md).

The shipped DSH transport uses the documented stdio JSON-RPC SDK profile directly: `initialize`, `session/prompt`, `session.event`, `session.status`. It does not depend on an undocumented web endpoint or control the Agent's GUI. The receiver writes its own durable session history under its configured Harness home. Setup writes `DSH_PERMISSION_MODE=workspace-write` into the launch environment; the adapter rejects any other value. Prefer a real `node` executable running the installed Harness JS CLI over a `.cmd` wrapper.

The shipped `deepseek-harness` adapter performs real dispatch. After the durable prompt receipt it requires `request/header`/`request/context` to confirm the configured provider/model, `sandbox/mode` to confirm `workspace-write`, and a valid `approval/policy`; a mismatch, or missing attestation within the receipt timeout, stops the receiver. Subagent sessions are watched for route drift. On Windows it runs a read-only ACL preflight of the project folder first and fails before starting a receiver if the signed-in account lacks effective ChangePermissions/TakeOwnership. The Harness sandbox confines writes and deletes only; reads, network access and process visibility stay unconfined, and there is no interactive approval channel, so approval requests are never granted and a run that needs one cannot be reported as completed. A custom adapter is trusted code and must implement its own isolation and route checks. The demo fixture exercises the full event path without a model call.

Configure credentials in the environment that launches Codex/the service, or through supported Harness credentials. Do not place actual secrets in `env`, scripts or committed files. Redaction is defense in depth, not a guarantee that arbitrary task text contains no secrets; the pre-dispatch scanner is the blocking control.

`retentionDays` defaults to 7 and accepts 1–30. Expired event logs and resolved job content are removed; a job with an unresolved recovery fence keeps a minimal ownership record so the workspace is not silently unlocked. `state.json` stores checkpoint summaries and hashes, not full instructions or full checkpoints; after a service restart, a task must provide a fresh checkpoint before handoff.

Cleanup has its own 30-second timer and does not depend on an active task or a successful quota request. A stopped service cleans overdue data at its next startup. Preflight uses a frozen payload and bundled Gitleaks rules; a content or launch change during scanning rejects that handoff attempt.

## Lifecycle

Tasks: `active → handed_off` or `completed`; `paused`, `waiting_user`, and `handoff_failed` are explicit non-dispatch states. Stops/interrupts pause undispatched work. The user must authorize continuation; the skill can then set it active.

Jobs: `preparing → accepted/running → ended | waiting_user | failed | cancelled`. Events are persisted in arrival order. A running notification or SDK receipt alone is not acceptance: the job is accepted only after the receipt plus provider/model, sandbox-mode and approval-policy attestation. Missing or mismatched attestation fails the job and stops the receiver. A final result can self-report completion. `relay_verify` only records user-supplied evidence; it does not execute acceptance commands, change a job to passed, or certify acceptance. Inspect the files and tests yourself.

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
