---
name: relay-setup
description: Set up Codex Agent Relay for the first time or open its Agent and model settings. Use after installing this plugin, or when the user wants to change the relay target. Do not select or change the receiving model without the user's choice.
---

# Set up Agent Relay

Call `relay_setup` with the current project cwd when known. Open the returned `dashboardUrl` in the current Codex right browser panel using `open_in_codex`, or the host's built-in browser. If the host cannot open it, provide the link.

The user selects the project, receiving Agent, provider and model in that page. First-time setup accepts the local DeepSeek Harness installation folder or its JavaScript CLI entry. Credential fields accept environment variable names, never key values. Saving config makes no model call and starts no task.

Do not choose a model on the user's behalf. Explain unavailable adapters honestly: the bundled adapter is DeepSeek Harness; Qoder CN and ZCode require additional adapters. Existing installed adapters appear in project settings.

After saving, remind the user to install/enable the plugin and review/trust its Hooks in Codex (`/hooks` or the host review UI). The plugin cannot bypass this step. Start a new project chat if the host needs one to load the plugin tools. Once loaded and the project enabled, the main relay skill registers execution tasks from hook instructions and handles low-quota handoff without a separate handoff request.

If the user asks to change only the model or target, use the existing project's settings. Changes apply to the next handoff. Do not create a duplicate task or restart an active receiver.
