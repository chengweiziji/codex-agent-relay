# Verification and compatibility

Recorded on 2026-10-29 (Asia/Shanghai). This file distinguishes current-build checks from historical real-model evidence. The current build dispatches for real through the shipped DeepSeek Harness adapter, gated on actual provider/model and sandbox attestation. Rows marked **historical** were recorded on an earlier build and are not current capability claims.

| Check | Result |
|---|---|
| TypeScript strict type check | Passed locally |
| Local runtime | Node.js 24.22.1 on Windows |
| Automated quota/state/transport/HTTP/MCP/setup tests | **64 passed locally on Windows** with a local Gitleaks 8.30.1 (`RELAY_TEST_GITLEAKS`); without it, 60 run and 4 real-scanner tests are explicitly skipped (`node --test test/*.test.ts`) |
| Security regression tests | Environment allowlist, project trust and launch revocation, confirmation gates, persisted-state omission, evidence-only verification, retention fence, restart checkpoint requirement, scanner failure blocking, process-tree stop |
| Installed copy with spaces and `$` in its path | Resolved Hook launcher and MCP startup passed in the automated suite |
| Source MCP exits after receipt | Detached service continued the simulated receiver to a persisted final result (automated fixture) |
| Built-in DeepSeek Harness dispatch | **Current:** real dispatch into the Harness `workspace-write` sandbox; acceptance requires prompt receipt plus `request/header`/`request/context`, `sandbox/mode` and `approval/policy` attestation; mismatch or timeout stops the receiver |
| Windows ACL preflight | **Current:** read-only PowerShell check of effective ChangePermissions/TakeOwnership; accepts user-profile projects, rejects a folder where the account lacks those rights |
| Real receiver smoke (committed build) | **Current (2026-10-29):** the opt-in smoke dispatched a disposable project to `deepseek-official/deepseek-v4-flash`; accepted only after route, `workspace-write` and `ask` attestation; ended with `reportedComplete: true` |
| Real code modification (committed build) | **Current:** receiver changed `sum.cjs` from `a - b` to `a + b`; `test.cjs` stayed unchanged |
| Independent verification (committed build) | **Current:** independent `node test.cjs` printed `SMOKE_TEST_PASSED`, exit 0 |
| Receiver's own shell verification (committed build) | **Current:** ran under `workspace-write` using an existing local Node binary; `node` was not on the receiver's PATH |
| Review regressions | Real Gitleaks 8.30.1: project rule and comment bypass blocked; project ignore file fails closed. Checkpoint/instruction/launch changes during scans reject dispatch; idle and stalled-quota retention, revoked-project form clearing and late responses covered |
| Demo path | Simulated quota and simulated Agent; no provider credentials or model call |
| Simulated Codex Hooks chain (current build) | **Current (2026-10-29):** the real Hook command and MCP stdio ran against a local daemon with the fixture Agent and simulated quota. SessionStart instruction, registration, 4% threshold instruction, Stop pause, explicit resume, in-flight handoff rejection, guarded handoff, PreToolUse denial for source tools, self-reported completion and evidence-only verification all passed. No provider call. |
| Dashboard live updates and save .md (current build) | **Current (2026-10-29):** the demo dashboard rendered the task, receipt and event timeline; the ended event arrived over SSE without a manual refresh; Save .md produced the expected filename and Markdown; a confirmed settings save persisted the threshold change and was then restored. Simulated Agent only. |
| Dashboard in the Codex right panel | Inspected at narrow panel width on an earlier build; configuration save and refresh/history recovery worked |
| Skill format validation | Passed with the skill-creator validator on an earlier build |
| Real Codex `account/rateLimits/read` through implemented adapter | **Historical:** connected successfully; no inference turn or quota reset |
| Installed DeepSeek Harness | **Historical:** `@deepseek-ai/dsh` 0.2.0-rc.2, standard SDK profile |
| Real receiver model | **Historical:** `deepseek-official` / `deepseek-v4-flash` |
| Real handoff acceptance | **Historical:** durable prompt receipt received |
| Real code modification | **Historical:** receiver changed a disposable sum fixture from subtraction to addition |
| Independent verification | **Historical:** `node test.cjs` printed `SUM_TEST_PASSED`; original test file unchanged |
| Receiver's own shell verification | **Historical:** blocked by Windows sandbox workspace provisioning (`Win32 5`); no interactive approval channel |
| Final receiver status | **Historical:** `waiting_user`, not falsely labeled completed |
| Live production Codex Hooks installation/trust | Not enabled in the user's global configuration during development; hook contract and resolved launcher are tested separately |
| Automatic right-panel opening | Host `open_in_codex` opened the demo in this Codex window on an earlier build; not yet tested as a trusted production plugin workflow |
| macOS / Linux | See [live GitHub Actions results](https://github.com/chengweiziji/codex-agent-relay/actions/workflows/ci.yml); real Harness execution was tested only on Windows |

The latest real run on the committed build used the opt-in smoke against a disposable two-file project, an explicitly authorized existing credential and simulated quota. It performed real dispatch, live route/sandbox attestation, `workspace-write`, a real file edit and independent verification. It does not establish unattended production readiness: Hooks installation/trust and right-panel opening still need host-side acceptance, and the Harness sandbox confines writes and deletes only, not reads, network or process visibility.

The automated suite exercises threshold crossing, weekly/short-window selection, missing/stale quota, duplicate dispatch, paused/completed/Plan states, state changes during quota reads, pending operations, workspace ownership (including unregistered chats and disabled projects), exact-model failure, acceptance timeout, process crash, route mismatch, missing route attestation, subagent route drift, child-only attestation, unapproved sandbox mode, unapproved approval policy, Windows ACL preflight, user-waiting states, configuration snapshots, restart recovery fences, removed workspace history, credential rejection, HTTP authentication/origin checks, SSE replay, installed Hooks/MCP, daemon execution after MCP exit, first-time setup, unchanged launch preferences, project configuration before task registration, environment allowlisting, trusted-project fingerprints, persisted-state omission, evidence-only verification, retention, scanner failures and process-tree termination.

## Public release gates

- Run `pnpm check`, `pnpm test`, and `node scripts/package.ts`.
- Inspect the allowlisted archive and `SHA256SUMS`; `.local/`, credentials, installed machine-specific copies and logs must be absent.
- Install through the local marketplace in a disposable project, review/trust Hooks, verify task registration and host panel opening for the intended client version.
- Keep real dispatch limited to the tested `workspace-write` sandbox and attested route; do not describe it as full filesystem or network isolation. An adapter claiming stronger isolation needs its own tested evidence.
- Publish as a preview while native host installation has not been verified on the target environment.

Official integration references: [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Hooks](https://learn.chatgpt.com/docs/hooks), [plugin packaging](https://developers.openai.com/plugins/build/plugins), [browser](https://learn.chatgpt.com/docs/browser), [DeepSeek Harness source](https://github.com/deepseek-ai/deepseek-harness).

The current suite has 64 tests. All 64 passed locally with a local Gitleaks 8.30.1; without `RELAY_TEST_GITLEAKS`, 60 run and the four real-scanner tests are explicitly skipped. CI installs the pinned official release after verifying its SHA-256 and requires those tests. `node scripts/install-test-scanner.ts` prints the isolated executable path for local use. No automated test calls a model provider.
