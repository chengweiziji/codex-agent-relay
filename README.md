# Codex Agent Relay

[简体中文](README.zh-CN.md) · [First-time setup](#first-time-setup) · [Verification](docs/verification.md)

When Codex is close to its usage limit and your task is unfinished, it sends the remaining work to another Agent on your computer. You choose the receiving Agent and model. Progress and the final answer appear in the right-hand panel of the same Codex window.

After the first setup, handoff is automatic for execution tasks in an enabled project. You do not need to watch the quota or paste instructions into the other Agent.

**Status:** v0.1.0 preview. **License:** MIT. **Bundled adapter:** DeepSeek Harness. Qoder CN and ZCode are not integrated yet.

## What happens in a chat

1. Codex works on your task and saves checkpoints.
2. At **5% or less remaining quota**, a tool-boundary hook asks Codex to finish or hand off. You can change the threshold.
3. If work remains, Codex saves the progress, remaining steps, changed files, tests and running-process identifiers, then sends the instructions to the receiver.
4. The chat shows the selected Agent, model and actual acceptance result. Codex stops source execution after dispatch.
5. The receiver continues in the project directory. The local panel shows activity, the final answer and test evidence. Use **Save .md** to export the result. File changes stay in the project.

The panel updates without further Codex inference. It does not insert new model-generated messages into an exhausted Codex chat. A receiver saying “complete” is shown separately from independent verification.

## Requirements

- Node.js **24+**, available as `node` in the terminal and Codex environment.
- Codex desktop or CLI with plugin Hooks and `account/rateLimits/read`. The right panel requires desktop.
- Local DeepSeek Harness with the standard `sdk` profile, an available model and working provider credentials.

Download the **whole project**. The skill, Hooks, MCP tools and service work together; copying `SKILL.md` alone cannot start background monitoring. No npm install is needed to run the relay.

## First-time setup

![First-time setup guide](docs/images/first-run-en.svg)

*Illustration with example paths, not evidence of a completed handoff.*

### 1. Install the plugin

[Download ZIP](https://github.com/chengweiziji/codex-agent-relay/archive/refs/heads/main.zip) and open a terminal in the extracted folder, or clone:

```sh
git clone https://github.com/chengweiziji/codex-agent-relay.git
cd codex-agent-relay
```

Prepare a **new** installation directory and add its local marketplace. These commands work in PowerShell and common Unix shells:

```sh
node scripts/install-local.ts --destination "$HOME/.local/share/codex-agent-relay"
codex plugin marketplace add "$HOME/.local/share/codex-agent-relay"
```

The installer prepares executable paths. It does not edit global Codex settings or enable existing projects. In Codex **Plugins**, select the local **Codex Agent Relay** source and install. Review and trust its Hooks using `/hooks` or the host review UI. Start a new chat if the host requires one to load tools. Trust is a Codex requirement; the skill cannot bypass it. [Official Hooks documentation](https://learn.chatgpt.com/docs/hooks)

### 2. Choose the project and model

Use the plugin's **Setup** action, ask Codex to “open Agent Relay settings,” or run:

```sh
node "$HOME/.local/share/codex-agent-relay/src/cli.ts" setup
```

Open the local URL it prints. Fill in:

| Setting | What to enter |
|---|---|
| Project folder | The project Codex is working in |
| Receiving Agent | DeepSeek Harness; other Agents need an adapter |
| Harness location | Its installation folder, package folder, or `@deepseek-ai/dsh/lib/bin.js` |
| Provider | Your configured provider, for example `deepseek-official` |
| Model | **Your choice**, using an available model ID from that provider |
| Threshold | Default `5`, meaning 5% remaining |
| Credentials | Environment variable **name**, e.g. `DEEPSEEK_API_KEY`; leave blank for Harness's existing credential setup |

Click **Save and enable**. This writes local configuration, without starting a task or calling a model. You can configure a project before its first task; no JSON editing is needed.

Do not enter an API key into the page. Set credential environment variables before starting the local service. Restart it after changing that environment. Existing Harness launch preferences are preserved.

### 3. Start a project chat

Start an execution task in the configured project. Trusted Hooks prompt Codex to register it and maintain checkpoints. For the first chat, you can explicitly invoke `$codex-agent-relay` and confirm the task appears in the panel. Once registered, no separate handoff request is needed.

Completed work, Plan mode, paused tasks and tasks waiting for your decision are excluded.

## Change the Agent or model

Open **Settings → project → Agent / Provider / Model → Save**, or ask Codex to open settings. Changes apply to the **next handoff**. Running receivers keep their original configuration.

The model is not preselected and has no silent fallback. Installed adapters appear in the Agent selector; [the adapter interface](docs/adapters.md) explains how to add one. Entering an Agent name alone does not implement its integration.

CLI users can run:

```sh
node src/cli.ts configure --project /path/to/project --model YOUR_MODEL_ID
node src/cli.ts dashboard
node src/cli.ts status
```

## Verified behavior and limits

- **32 tests passed locally on Windows**, including installed Hooks/MCP, quota thresholds, duplicate dispatch, project isolation, setup and execution after source MCP exit. Type checking and skill validation passed. [Tested versions and evidence](docs/verification.md)
- A real Harness run accepted a task and modified a disposable project. Independent testing passed. Its own shell verification was blocked by Windows sandbox provisioning, so it reported `waiting_user`.
- A fully installed-and-trusted production Hooks workflow still needs host-side acceptance testing. Cross-platform CI is supplied; actual runs appear in this repository's Actions tab.
- A long request can consume the reserve before a hook runs. Unknown or exhausted quota retains the checkpoint and does not fabricate a handoff.
- The receiver keeps its own permissions and sandbox. The relay does not auto-approve requests or disable protections.

Try a disposable project first. The demo uses **simulated quota and a simulated Agent**, needs no credentials, and prints a local panel URL:

```sh
node scripts/demo.ts
```

## Development

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
node scripts/docs-figures.ts
node scripts/package.ts
```

The release uses an explicit file list. Credentials, real task history, local installations and logs are excluded. `dist/` contains the archive, manifest and SHA-256 checksum.

Optional real test: set `RELAY_REAL_DSH_BIN`, `DEEPSEEK_API_KEY` and your chosen `RELAY_REAL_MODEL`, then run `node scripts/smoke-real.ts`. It uses a disposable project and simulated Codex quota but makes **real paid provider calls**. Artifacts stay in ignored `.local/`.

## Disable or uninstall

Uncheck **Enable relay** in settings to prevent future handoffs. Stop active receivers from the progress page and inspect separately launched background jobs. Disabling a project does not cancel its running receiver or remove its ownership guard.

Disable/uninstall the plugin and remove its marketplace source in Codex. Stop the specific service recorded in the relay home's `server.json`, or use Ctrl+C for a foreground server. Checkpoints and project changes are retained unless you deliberately delete them. [Configuration and recovery](docs/configuration.md)

GitHub distribution is separate from OpenAI's public plugin directory, which currently excludes lifecycle Hooks. This project provides source for local installation. [Official packaging documentation](https://developers.openai.com/plugins/build/plugins)
