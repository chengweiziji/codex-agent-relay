# Security and data handling

This page describes the trust boundary of the current build. It is not a claim that the relay itself is a sandbox. The built-in DeepSeek Harness adapter dispatches for real only into the Harness `workspace-write` sandbox, after attesting the actual provider/model, sandbox mode and approval policy on the live session, and after a read-only Windows ACL preflight of the project folder.

## Project approval

- Enabling a project is an explicit user action. The setup page requires a confirmation dialog; `cli init` and `cli configure` require `--approve`; the HTTP API rejects configuration writes without `confirmed: true`.
- Approval is stored in `<relay-home>/trusted-projects.json`, keyed by a hash of the canonical project path. A record contains the approved configuration, a configuration fingerprint and a launch fingerprint.
- A repository or parent-directory `.agent-relay.json` is never trusted and is no longer read. Nested directories do not inherit an enabled project; the project root must be approved.
- The launch fingerprint covers the selected Agent launch, installed adapter module and secret-scanner launch in `user.json`. Editing any of them revokes the project approval until an explicit configuration save. This is intentional: a changed executable is a changed trust decision.
- Treat the relay home as local task data. Protect `trusted-projects.json`, `state.json`, `user.json`, `server.json` and event logs from other users and from backups you do not control.

## What leaves this computer

A handoff gives the configured adapter the project path, checkpoint, remaining instruction and task context. The adapter sends that content to its provider. Depending on the task, this may include source code, file names, test output, tool metadata and any text placed in the checkpoint.

Provider retention, training use and jurisdiction depend on the provider's terms and the user's account; the relay cannot guarantee zero retention. Do not put unrelated personal data, credentials or regulated data into a checkpoint. The dashboard and control service stay local, but that does not make the model request local.

Before creating a job, the relay runs a local secret scanner:

- The default scanner is `gitleaks`, which must be installed and on the service's `PATH`, or configured as `scanner` in `user.json`.
- It scans the serialized handoff payload through stdin and the project directory.
- Both scans use the bundled `src/security/gitleaks.toml` and empty ignore list, and ignore `gitleaks:allow` comments. The scanner starts in the trusted plugin directory. A project's `.gitleaks.toml`, `.gitleaksignore`, or working-directory executable cannot replace these controls.
- Gitleaks 8.30.1 still merges a source-root `.gitleaksignore` even with an explicit ignore-file option. Relay therefore **blocks handoff if that file exists**, checked before and after scanning. It never removes or rewrites the project file. A future scanner with a verified no-project-ignore mode can lift this restriction. Scanning is not an OS lock against another process changing workspace files during execution.
- The payload is snapshotted before scanning. A checkpoint, instruction or launch change during preflight cancels dispatch; the user must retry with the updated content. Only the scanned snapshot is handed off.
- A missing scanner, scanner failure, timeout or any finding blocks the handoff. Findings are not written to logs, and only a generic error is returned.
- Redaction in logs and persisted state is defense in depth, not a scanner and not a guarantee. A secret that is not recognized by a pattern or scanner can still be sent.

Set `scanner` to a reviewed local command if another scanner is used. The command receives the mandatory `--config`, `--gitleaks-ignore-path`, `--ignore-gitleaks-allow`, `--no-banner`, `--redact`, and `--exit-code 23` options. It must honor those protections, read the payload from stdin for the `stdin` subcommand, accept a `dir <path>` subcommand, and exit `0` only when clean and `23` when findings exist. Relative launcher paths resolve from the plugin's security directory; use an absolute executable path or a trusted PATH entry. Do not point it at a remote upload service. A custom scanner is trusted code, not an untrusted project setting.

## Environment passed to a receiver

Receivers do not inherit the full service environment. They receive a fixed allowlist of ordinary runtime variables (`PATH`, `SYSTEMROOT`, `WINDIR`, `COMSPEC`, `PATHEXT`, `TEMP`, `TMP`, `TMPDIR`, `LANG`, `LC_ALL` and proxy variables), plus only the explicit `env` entries and `envFrom` references in the user-level launch configuration. Injection variables such as `NODE_OPTIONS`, `NODE_PATH`, `LD_*`, `DYLD_*` and `PYTHONPATH` are rejected.

`envFrom` copies a variable from the service's environment; the secret value is never stored in `user.json`. `HOME` and `USERPROFILE` are not inherited by receivers by default. If a receiver requires its own home directory, set an explicit non-secret path in that launch's `env`. The service launcher itself forwards the homes and credential-variable sources it needs to start, but those values are still not exposed to project code.

## Persisted data and retention

- `state.json` stores task/job metadata, checkpoint summaries, hashes and redacted results. Full handoff instructions and full checkpoints are omitted; a restarted service requires a fresh checkpoint before another handoff.
- Event logs contain redacted activity and final text. They are local files and should be protected like task content.
- `retentionDays` in `user.json` defaults to 7 and accepts 1–30. Expired event logs and resolved job content are deleted. A job that still needs recovery inspection keeps a minimal ownership record (not its full content) so the workspace fence is not silently removed.
- Cleanup runs at startup and every 30 seconds while the service is running, including idle periods and stalled quota reads. When the computer or service is stopped, overdue cleanup runs on the next startup.
- Backups, filesystem snapshots and provider-side copies are outside the relay's retention control.

## Process containment

Stopping a job terminates the owned process tree with a process group on POSIX or `taskkill /T /F` on Windows. This is cleanup, not a filesystem or network sandbox. Deliberately detached or background processes may survive; a cancelled or crashed job keeps a recovery fence until the user inspects the former runtime and supplies explicit recovery evidence.

The shipped DeepSeek Harness adapter confines writes and deletes to the workspace through the Harness `workspace-write` sandbox. Reads, network access and process visibility are not confined: the receiver can read files outside the project and reach the network. Approvals have no interactive channel and are never granted: a run that needs one cannot be reported as completed. The adapter verifies the live session's actual provider/model, sandbox mode and approval policy, watches subagent sessions for route drift, and stops the receiver on any mismatch. On Windows it refuses to start if the project folder does not grant the signed-in account effective ChangePermissions and TakeOwnership, because the sandbox cannot provision otherwise. A custom adapter is trusted user-installed code and is responsible for its own isolation, credential handling and provider/model validation. Do not describe a custom adapter as sandboxed unless that property has been tested.

## Verification

`relay_verify` records user-supplied evidence only. It does not execute acceptance commands and does not certify that the task passed. An Agent's “completed” marker, a final message and an `ended` state are all separate from acceptance. Inspect the working tree and test results yourself before treating work as accepted.

## Limits and reporting

The relay does not protect against a compromised local account, malicious user-installed adapter code, a compromised provider, or a scanner that misses a secret. Report vulnerabilities without including real credentials, private task text or personal paths; rotate any credential that may have been exposed.
