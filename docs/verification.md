# Verification and compatibility

## Latest desktop acceptance follow-up (2026-10-30)

Final regression on the resulting working tree: strict TypeScript check passed; **80/80 automated tests passed, zero skips**, with Gitleaks 8.30.1 enabled. The versioned Hooks E2E and Edge dashboard E2E passed again. The source archive contains 68 allowlisted files and excludes local state, credentials and node_modules. No new model calls were made during this final regression.

This section supersedes pending-status statements in the earlier attempt records below. It establishes a user-approved handoff under simulated quota, not unattended handoff without host approval.

The user reported that the desktop model confirmed simulated 4% quota, resumed the paused task, updated its checkpoint and called `relay_handoff`; the source then stopped without modifying files. This model-call sequence is user-reported here, not independently extracted from a host transcript.

Independent filesystem/state checks confirmed job `0e99a038-0e10-4b94-ac69-c67123ad5aa8`, receipt `0986ef0f-ed42-40f6-a469-70a06c073796`, `ended`, and `reportedComplete: true`. Its persisted timeline contains accepted (sequence 7) followed by ended (sequence 34). The disposable workspace contains only `sum.cjs` and `test.cjs`; the implementation is now addition. The test retained SHA-256 `203c68ae289e2fd0afea6b4b3a41f92cccd61e5370621d01c9db97573f5085c0`. An independent local Node invocation printed `HOST_TEST_PASSED` and exited 0.

The initial dashboard-open request was reported as `queued`; the user subsequently confirmed that the right panel appeared and displayed the final result. This is user-observed desktop evidence, not an independently captured UI trace. Continuous updates without inference were exercised separately by the simulated browser test. Quota was simulated, so this is not evidence of a real account threshold crossing. Earlier failed attempts below remain historical evidence of the issues encountered.

During this follow-up, the acceptance client was changed to reject normal-daemon fallback in a marked test home. The isolated daemon now initializes and refreshes its simulated quota even with paused tasks. Type checking and the new fallback regression passed; the earlier 79-test result predates these two follow-up changes.

Baseline recorded on 2026-10-29 (Asia/Shanghai); native-host checks added on 2026-10-30. This file distinguishes current-build checks from historical real-model evidence. The baseline build dispatches for real through the shipped DeepSeek Harness adapter, gated on actual provider/model and sandbox attestation. Rows marked **historical** were recorded on an earlier build and are not current capability claims.

| Check | Result |
|---|---|
| TypeScript strict type check | Passed locally |
| Local runtime | Node.js 24.22.1 on Windows |
| Automated quota/state/transport/HTTP/MCP/setup tests | **79 passed locally on Windows (2026-10-30, latest repair)** with a local Gitleaks 8.30.1 (`RELAY_TEST_GITLEAKS`); without it, 75 run and 4 real-scanner tests are explicitly skipped (`node --test test/*.test.ts`) |
| Security regression tests | Environment allowlist, project trust and launch revocation, confirmation gates, persisted-state omission, evidence-only verification, retention fence, restart checkpoint requirement, scanner failure blocking, process-tree stop |
| Installed copy with spaces and `$` in its path | Resolved Hook launcher and MCP startup passed in the automated suite |
| Source MCP exits after receipt | Detached service continued the simulated receiver to a persisted final result (automated fixture) |
| Built-in DeepSeek Harness dispatch | **Baseline b4c953a:** real dispatch into the Harness `workspace-write` sandbox; acceptance requires prompt receipt plus `request/header`/`request/context`, `sandbox/mode` and `approval/policy` attestation; mismatch or timeout stops the receiver |
| Windows ACL preflight | **Baseline b4c953a:** read-only PowerShell check of effective ChangePermissions/TakeOwnership; accepts user-profile projects, rejects a folder where the account lacks those rights |
| Real receiver smoke (committed build) | **Historical baseline b4c953a (2026-10-29):** the opt-in smoke dispatched a disposable project to `deepseek-official/deepseek-v4-flash`; accepted only after route, `workspace-write` and `ask` attestation; ended with `reportedComplete: true` |
| Real code modification (committed build) | **Baseline b4c953a:** receiver changed `sum.cjs` from `a - b` to `a + b`; `test.cjs` stayed unchanged |
| Independent verification (committed build) | **Baseline b4c953a:** independent `node test.cjs` printed `SMOKE_TEST_PASSED`, exit 0 |
| Receiver's own shell verification (committed build) | **Baseline b4c953a:** ran under `workspace-write` using an existing local Node binary; `node` was not on the receiver's PATH |
| Review regressions | Real Gitleaks 8.30.1: project rule and comment bypass blocked; project ignore file fails closed. Checkpoint/instruction/launch changes during scans reject dispatch; idle and stalled-quota retention, revoked-project form clearing and late responses covered |
| Demo path | Simulated quota and simulated Agent; no provider credentials or model call |
| Simulated Codex Hooks chain (current build) | **Current (2026-10-30):** the versioned `node scripts/hooks-e2e.ts` ran the real Hook command and MCP stdio against a local daemon with the fixture Agent and simulated quota; 11 checks passed. SessionStart instruction, registration, 4% threshold instruction, Stop pause, explicit resume, in-flight handoff rejection, guarded handoff, PreToolUse denial for source tools, self-reported completion and evidence-only verification all passed. No provider call. |
| Native Codex host Hooks and model-driven relay calls (current build) | **Current (2026-10-30):** Codex 0.166.0-alpha.5.1 (complete app-server build) loaded the installed acceptance plugin; all seven Hooks were listed as trusted in the captured output; that output alone does not establish how trust was granted. A real headless app-server thread executed `sessionStart` (792 ms) and `userPromptSubmit` (759 ms) with the thread's session ID and target `deepseek-harness/deepseek-v4-flash`; the model read the skill and called `relay_register` (task `54951a9d-…`) and `relay_checkpoint` successfully, announced the handoff, then called `relay_handoff`. Codex rejected that call because the tool is marked destructive and the probe thread ran with `approvalPolicy: never`; no receiver job was created and no project file changed. The right-panel `cua_repl/js` call failed. |
| Host-level handoff of the native task (current build) | **Current (2026-10-30):** after the model-driven registration, the authenticated relay API saved a fresh checkpoint on the same task and dispatched it without a model call or Codex quota (simulated 4% quota, threshold 5%). Job `e7007e06-…` reached `accepted` only after DSH emitted `request/header`/`request/context` = `deepseek-official`/`deepseek-v4-flash`, `sandbox/mode` = `workspace-write` and `approval/policy` = `ask`; it ended with `reportedComplete: true` and receipt `b2961602-…`. |
| Real code modification and independent check (current build) | **Current (2026-10-30):** the receiver changed `sum.cjs` from `a - b` to `a + b`; `test.cjs` kept SHA-256 `203c68ae…f5085c0`; the project contained only the two expected files; independent `node test.cjs` exited 0 and printed `HOST_TEST_PASSED`. |
| Native automatic handoff approval | **Not yet accepted:** in a real host the destructive `relay_handoff` call needs a user approval (or an explicit opt-in approval configuration). The headless probe cannot supply that without bypassing Codex's protection, so the fully automatic threshold→handoff→approval path remains pending host acceptance. |
| Dashboard live updates and save .md (current build) | **Historical baseline b4c953a (2026-10-29):** the demo dashboard rendered the task, receipt and event timeline; the ended event arrived over SSE without a manual refresh; Save .md produced the expected filename and Markdown; a confirmed settings save persisted the threshold change and was then restored. Simulated Agent only. |
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
| Live production Codex Hooks installation/trust | An acceptance plugin was installed in the local Codex profile on 2026-10-30. This does not establish production deployment or trust for a newly changed plugin copy |
| Automatic right-panel opening | Host `open_in_codex` opened the demo in this Codex window on an earlier build; not yet tested as a trusted production plugin workflow |
| macOS / Linux | See [live GitHub Actions results](https://github.com/chengweiziji/codex-agent-relay/actions/workflows/ci.yml); real Harness execution was tested only on Windows |

The 2026-10-30 native-host run is the latest real evidence. A real Codex 0.166 thread listed all seven Hooks as trusted; execution evidence covers SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and Stop, not Interrupt or SessionEnd, and the model itself registered the task and saved a checkpoint; Codex then required approval for the destructive handoff call, which the headless probe could not grant. To verify the receiver without spending more Codex quota, the same task was given a fresh checkpoint and dispatched through the authenticated relay API under simulated 4% quota: it ran the real DeepSeek Harness with route, `workspace-write` and `ask` attestation, changed only `sum.cjs`, ended with `reportedComplete: true`, and an independent `node test.cjs` printed `HOST_TEST_PASSED`. This does not establish unattended production readiness: a real host still needs a user approval (or an explicit opt-in approval mode) for handoff, and right-panel opening remains unverified (the CUA call failed). The Harness sandbox confines writes and deletes only, not reads, network or process visibility.

The automated suite exercises threshold crossing, weekly/short-window selection, missing/stale quota, duplicate dispatch, paused/completed/Plan states, state changes during quota reads, pending operations, workspace ownership (including unregistered chats and disabled projects), exact-model failure, acceptance timeout, process crash, route mismatch, missing route attestation, subagent route drift, child-only attestation, unapproved sandbox mode, unapproved approval policy, Windows ACL preflight, user-waiting states, configuration snapshots, restart recovery fences, removed workspace history, credential rejection, HTTP authentication/origin checks, SSE replay, installed Hooks/MCP, daemon execution after MCP exit, first-time setup, unchanged launch preferences, project configuration before task registration, environment allowlisting, trusted-project fingerprints, persisted-state omission, evidence-only verification, retention, scanner failures and process-tree termination.

## Public release gates

- Run `pnpm check`, `pnpm test`, and `node scripts/package.ts`.
- Inspect the allowlisted archive and `SHA256SUMS`; `.local/`, credentials, installed machine-specific copies and logs must be absent.
- Install through the local marketplace in a disposable project, review/trust Hooks, verify task registration and host panel opening for the intended client version.
- Keep real dispatch limited to the tested `workspace-write` sandbox and attested route; do not describe it as full filesystem or network isolation. An adapter claiming stronger isolation needs its own tested evidence.
- Publish as a preview while native host installation has not been verified on the target environment.

Official integration references: [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Hooks](https://learn.chatgpt.com/docs/hooks), [plugin packaging](https://developers.openai.com/plugins/build/plugins), [browser](https://learn.chatgpt.com/docs/browser), [DeepSeek Harness source](https://github.com/deepseek-ai/deepseek-harness).

The suite now has 79 tests. All 79 passed locally with a local Gitleaks 8.30.1; without `RELAY_TEST_GITLEAKS`, 75 run and the four real-scanner tests are explicitly skipped. CI installs the pinned official release after verifying its SHA-256 and requires those tests. `node scripts/install-test-scanner.ts` prints the isolated executable path for local use. No automated test calls a model provider.

## Review fixes (2026-10-30)

The 2026-10-29 real-model rows above describe the previous build; they do not validate the review fixes. The 2026-10-30 rows record a new real-provider run on the current build: a real host model turn plus a host-level handoff with route, sandbox and approval-policy attestation.

- Recursive child-session checks, child attestation/completion requirements, validation through transport shutdown, and approval-event failure are now implemented.
- Workspace operation fences include other registered and unregistered chats and survive daemon restart. An unresolved operation remains fenced; inspect its process before recording background-process evidence to release its ID.
- Windows preflight opens the directory with WRITE_DAC/WRITE_OWNER and immediately closes the handle. Windows evaluates effective permissions; no ACL mutation occurs in production. Tests use only disposable ACL fixtures.
- `node scripts/hooks-e2e.ts` is the versioned simulated Hook/MCP chain. It does not by itself prove native client installation or trust; the native host row above records that separately.
- `node scripts/dashboard-e2e.ts` is the versioned real-browser test using a simulated receiver. It checks SSE reconnect/replay, download contents/filename, and confirmed settings persistence. Provide Playwright via a local installation or `RELAY_PLAYWRIGHT` pointing to its `index.mjs`; optionally set `RELAY_BROWSER_CHANNEL=msedge` to use installed Edge.
- The real smoke now requires a durable receipt, self-reported completion, passing independent command with timeout, unchanged test hash, and no extra project files; it records command, exit code and output hash in the ignored local verification artifact.
- Runtime attestation is checked after prompt enqueue. It is not a synchronous receiver execution barrier. No guarantee is made that a mismatched receiver performed no work before termination.

Native trusted Codex automatic triggering is partially verified: a real model turn exercised registration, checkpointing and a handoff attempt, but Codex required user approval for the destructive tool and the headless thread could not approve it. The receiver path was then verified host-level (see the rows above). Same-chat right-panel opening remains unverified. Do not treat the simulated chain or headless browser test as that acceptance.

### Results of the review-fix checks

On 2026-10-30: `pnpm check` passed; `node --test test/*.test.ts` passed **73/73**, with real Gitleaks enabled (no skips). `node scripts/hooks-e2e.ts` passed. `node scripts/dashboard-e2e.ts` passed with installed Edge and Playwright 1.62.1, including a deliberately closed first SSE response followed by reconnect. These checks used no model provider. The local acceptance plugin was installed through `codex plugin marketplace add` and `codex plugin add`; its seven Hooks were listed as trusted; execution was observed for SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and Stop (Interrupt and SessionEnd execution was not established), and the bundled MCP server reached ready. After quota returned, the same host build ran a real model turn that called `relay_register` and `relay_checkpoint`; Codex blocked its `relay_handoff` call pending approval. The same task was then handed off through the authenticated API (no extra model quota) and the real receiver, attested route/sandbox/policy and independent test all passed. Fully automatic user-approved handoff and right-panel opening remain unverified.

## Failure completion and evidence boundaries

The documented Codex `PostToolUse` event includes Bash commands that exit nonzero. The manifest intentionally does not add an undocumented `PostToolUseFailure` event. The service accepts that event defensively, but its unit test is not evidence that Codex emits it. If a host aborts without a terminal notification, the operation remains fenced; do not clear it merely because a chat stopped. Inspect the process and record its tool ID and process evidence before using checkpoint background release.

A checkpoint permission string describes intended constraints, not enforced host permissions. Record the actual thread sandbox, approval policy, and raw Hook `permission_mode` as separate fields. The earlier claim of read-only/never does not prove the Hook permission mode; the cited evidence does not resolve the reported bypassPermissions discrepancy.

The host-test daemon now requires `host-test.json` in an isolated relay home with `{ "purpose": "disposable-host-acceptance", "project": "<absolute disposable project path>" }`. Exactly one trusted project and matching task/job history are required. The standard production home is refused. Scope is rechecked on registration, Hooks, quota refresh and dispatch. Never place this marker in production state.

Latest repair validation (2026-10-30, uncommitted working tree): strict type check passed; 79/79 tests passed with real Gitleaks and zero skips; the versioned simulated Hooks and Edge dashboard tests passed. These results do not establish a new real-model handoff. A fresh isolated native fixture was prepared; its starting sum test fails as expected. The subsequent desktop result is recorded at the top of this document, with its independent checks and user-reported observations distinguished.
