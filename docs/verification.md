# Verification and compatibility

Recorded on 2026-10-29 (Asia/Shanghai). This file distinguishes current-build checks from historical real-model evidence. The current build intentionally blocks built-in real dispatch; rows marked **historical** were recorded on an earlier build and are not current capability claims.

| Check | Result |
|---|---|
| TypeScript strict type check | Passed locally |
| Local runtime | Node.js 24.22.1 on Windows |
| Automated quota/state/transport/HTTP/MCP/setup tests | **59 passed locally on Windows** (`node --test test/*.test.ts`) |
| Security regression tests | Environment allowlist, project trust and launch revocation, confirmation gates, persisted-state omission, evidence-only verification, retention fence, restart checkpoint requirement, scanner failure blocking, process-tree stop |
| Installed copy with spaces and `$` in its path | Resolved Hook launcher and MCP startup passed in the automated suite |
| Source MCP exits after receipt | Detached service continued the simulated receiver to a persisted final result (automated fixture) |
| Built-in DeepSeek Harness dispatch | **Blocked by design** before a receiver process is spawned; requires a verified isolated adapter and actual-route attestation |
| Review regressions | Real Gitleaks 8.30.1: project rule and comment bypass blocked; project ignore file fails closed. Checkpoint/instruction/launch changes during scans reject dispatch; idle and stalled-quota retention, revoked-project form clearing and late responses covered |
| Demo path | Simulated quota and simulated Agent; no provider credentials or model call |
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

The historical real run used a disposable two-file project and an explicitly authorized existing credential held in process environment. It used simulated quota to avoid exhausting Codex. No key, raw task history, personal path or private run log is included in the release. It demonstrates that the transport and event path worked on that build. It does **not** prove current unattended execution: the shipped adapter now refuses dispatch until isolation and actual-model attestation are implemented.

The automated suite exercises threshold crossing, weekly/short-window selection, missing/stale quota, duplicate dispatch, paused/completed/Plan states, state changes during quota reads, pending operations, workspace ownership (including unregistered chats and disabled projects), exact-model failure, acceptance timeout, process crash, user-waiting states, configuration snapshots, restart recovery fences, removed workspace history, credential rejection, HTTP authentication/origin checks, SSE replay, installed Hooks/MCP, daemon execution after MCP exit, first-time setup, unchanged launch preferences, project configuration before task registration, environment allowlisting, trusted-project fingerprints, persisted-state omission, evidence-only verification, retention, scanner failures and process-tree termination.

## Public release gates

- Run `pnpm check`, `pnpm test`, and `node scripts/package.ts`.
- Inspect the allowlisted archive and `SHA256SUMS`; `.local/`, credentials, installed machine-specific copies and logs must be absent.
- Install through the local marketplace in a disposable project, review/trust Hooks, verify task registration and host panel opening for the intended client version.
- Keep the built-in receiver disabled unless a reviewed adapter demonstrates filesystem/network isolation and actual provider/model attestation. Do not mark real dispatch “fully supported” based only on mocks or historical runs.
- Publish as a preview while receiver isolation or native host installation has not been verified on the target environment.

Official integration references: [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Hooks](https://learn.chatgpt.com/docs/hooks), [plugin packaging](https://developers.openai.com/plugins/build/plugins), [browser](https://learn.chatgpt.com/docs/browser), [DeepSeek Harness source](https://github.com/deepseek-ai/deepseek-harness).

The current suite has 59 tests when `RELAY_TEST_GITLEAKS` points to a trusted Gitleaks 8.30.1 executable. Four real-scanner tests are explicitly skipped on a local machine without that variable; CI installs the pinned official release after verifying its SHA-256 and requires those tests. `node scripts/install-test-scanner.ts` prints the isolated executable path for local use. No test calls a model provider.
