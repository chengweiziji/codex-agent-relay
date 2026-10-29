# Verification and compatibility

Recorded on 2026-10-29 (Asia/Shanghai). This file distinguishes executed checks from provided CI configuration.

| Check | Result |
|---|---|
| TypeScript strict type check | Passed locally |
| Local runtime / quota client | Node.js 24.22.1; `codex-cli` 0.165.0-alpha.1.2 on Windows |
| Automated quota/state/transport/HTTP/MCP/setup tests | 32 passed locally on Windows |
| First-time setup | User-selected provider/model saved without starting a task; project settings available before registration; actual panel save, model edit and reload verified |
| Installed copy with spaces and `$` in its path | Resolved Hook launcher and MCP startup passed in an isolated directory |
| Source MCP exits after receipt | Detached service continued the simulated receiver to a persisted final result |
| Dashboard in the Codex right panel | Opened and inspected at the actual narrow panel width; configuration save and refresh/history recovery passed |
| Skill format validation | Passed with the skill-creator validator |
| Real Codex `account/rateLimits/read` through implemented adapter | Connected successfully; no inference turn or quota reset |
| Installed DeepSeek Harness | `@deepseek-ai/dsh` 0.2.0-rc.2, standard SDK profile |
| Real receiver model | `deepseek-official` / `deepseek-v4-flash` |
| Real handoff acceptance | Durable prompt receipt received |
| Real code modification | Receiver changed the disposable sum fixture from subtraction to addition |
| Independent verification | `node test.cjs` printed `SUM_TEST_PASSED`; original test file unchanged |
| Receiver's own shell verification | Blocked by Windows sandbox workspace provisioning (`Win32 5`); no interactive approval channel |
| Final receiver status | `waiting_user`, not falsely labeled completed |
| Live production Codex Hooks installation/trust | Not enabled in the user's global configuration during development; hook contract and resolved launcher tested separately |
| Automatic right-panel opening | Host `open_in_codex` opened the demo in this Codex window; not yet tested as a trusted production plugin workflow |
| macOS / Linux | See [live GitHub Actions results](https://github.com/chengweiziji/codex-agent-relay/actions/workflows/ci.yml); real Harness execution was tested only on Windows |

The real run used a disposable two-file project and an explicitly authorized existing credential held in process environment. It used simulated quota to avoid exhausting Codex. No key, raw task history, personal path or private run log is included in the release.

The real test demonstrates transport, receiver execution, result streaming and honest blocked-state handling. It does **not** prove unrestricted unattended shell execution on this Windows installation. Resolve the receiver's own sandbox setup through its supported installation/permission workflow before depending on shell-heavy unattended tasks. The relay does not disable that sandbox.

Tests exercise threshold crossing, weekly/short-window selection, missing/stale quota, duplicate dispatch, paused/completed/Plan states, state changes during quota reads, pending operations, workspace ownership (including unregistered chats and disabled projects), exact-model failure, acceptance timeout, process crash, user-waiting states, configuration snapshots, restart recovery fences, removed workspace history, credential rejection, HTTP authentication/origin checks, SSE replay, installed Hooks/MCP, daemon execution after MCP exit, first-time setup, unchanged launch preferences and project configuration before task registration.

## Public release gates

- Run `pnpm check`, `pnpm test`, and `node scripts/package.ts`.
- Inspect the allowlisted archive and `SHA256SUMS`; `.local/`, credentials, installed machine-specific copies and logs must be absent.
- Install through the local marketplace in a disposable project, review/trust Hooks, verify task registration and host panel opening for the intended client version.
- Publish as a preview while the receiver sandbox or native host installation has not been verified on the target environment. Do not change this table to “fully supported” based only on mocks.

Official integration references: [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Hooks](https://learn.chatgpt.com/docs/hooks), [plugin packaging](https://developers.openai.com/plugins/build/plugins), [browser](https://learn.chatgpt.com/docs/browser), [DeepSeek Harness source](https://github.com/deepseek-ai/deepseek-harness).
