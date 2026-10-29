---
name: codex-agent-relay
description: Preserve and hand off unfinished execution tasks to a project-configured Agent when Codex usage quota becomes low. Use when a configured project hook requests relay registration or quota handoff, or the user requests Agent Relay setup or status. Do not delegate casual questions, completed work, Plan mode, or work awaiting user decisions.
---

# Codex Agent Relay

This skill works with the bundled `agent_relay` MCP server and reviewed/trusted Hooks. Installing this Markdown alone does not create automatic monitoring. Read [configuration](../../docs/configuration.md) for setup or changing the project's target Agent/model.

For first-time setup or a model change, call `relay_setup` and open its settings page in the right browser panel. Let the user select the target; do not guess a model or substitute one.

## Track an opted-in execution task

- Use the hook-supplied `session_id` and cwd; never invent a Codex session ID. Register through `relay_register` only when the project is enabled and there is authorized execution work. The returned `id` is the task ID.
- Checkpoints include `goal`, `completed`, `remaining`, `decisions`, `files`, `tests`, `processes`, `permissions`, and `acceptance`. All fields except goal/permissions are string arrays. Capture useful verified evidence, not the whole conversation. Do not include credentials or unrelated personal/project context.
- Update `relay_checkpoint` after meaningful milestones and immediately before handoff. Record existing process IDs, remote job IDs, command/tool IDs and observed state so the receiver can inspect them without restarting them.
- Call `relay_finish` when acceptance criteria are met. Use `relay_task_state` for `waiting_user` or `paused` when appropriate. A later authorized continuation can set an undispatched task back to `active`; do not resume a user-paused task autonomously.
- Plan-mode tasks stay paused. Neither quota pressure nor this skill grants permission to execute a plan.

## Hand off at the quota reminder

1. Decide whether the original task is already complete. If so, mark it complete instead of handing off.
2. Finish current file operations and save a fresh checkpoint. If a tool is intentionally running an existing background job, inspect it first and record its identity/state. Only then pass its hook tool ID in `backgroundToolIds`; this removes it from the pending-operation barrier without stopping/restarting it.
3. Tell the user: `额度即将用尽，开始调用 <configured Agent>，模型：<configured model>。` Use the actual project target. This is an external Agent invocation, not a change to Codex's selected model.
4. Call `relay_handoff` with the task ID and concrete remaining instructions. Include the next step, necessary constraints and validation. Do not repeatedly retry uncertain submissions. The relay persists a job ID and returns the same job for duplicate calls.
5. Report what the returned state proves. A receipt means accepted; `preparing` does not. `failed` means no success claim is justified. Display the returned error concisely. This preview's bundled adapter returns an explicit dispatch-disabled error; report it and stop. Do not retry, substitute another model, or describe the attempt as a successful handoff.
6. Open the returned `dashboardUrl` in the current Codex window's right browser panel using `open_in_codex` if available (browser target, right placement). Otherwise use the host's built-in browser. If neither capability exists, provide the local link and state that automatic panel opening is unavailable.
7. Stop executing the source task. The external process owns the remaining work. The progress page reads its events directly; do not keep polling with model turns to imitate live progress.

The page continues independently of Codex inference. A run ending and an Agent saying “complete” do not prove acceptance. When asked to review the outcome, inspect the actual files/tests before using `relay_verify` with concrete evidence. `relay_verify` records evidence only; it does not certify a pass. Requests to change Agent/model update project configuration for future jobs only.

## Failures

Unknown quota is not zero. If the quota is already exhausted, retain the checkpoint and explain that no confirmed handoff occurred. Do not fabricate a late Codex instruction or silently submit a stale checkpoint. Missing target models fail explicitly; do not substitute another model or loosen permissions. Handoff also fails closed when project approval was revoked by a `user.json` launch/adapter/scanner edit, when the local secret scanner is missing or reports a finding, or when the bundled adapter refuses dispatch. Explain the specific error; never bypass the scanner or approve configuration on the user's behalf. If hooks or MCP tools are unavailable, explain the missing installation capability instead of claiming automatic protection is active.
