# Extending Agent Relay

Adapters are trusted user-installed code, loaded only from absolute module paths in the **user** configuration. Project config cannot install or select arbitrary executable code.

Implement `AgentAdapter` from `src/types.ts` and default-export an instance:

```ts
interface AgentAdapter {
  validate(config: ProjectConfig, launch: LaunchConfig): void;
  start(job: Job, launch: LaunchConfig, emit: (event: AdapterEvent) => void): AgentRun;
}
interface AgentRun {
  done: Promise<void>;
  stop(): Promise<void>;
}
```

Register it under `adapterModules` and a same-named `agents` launch entry, restart the service, then select its ID in a project's config. Unsupported Agent IDs fail; they do not silently use DeepSeek.

The adapter must validate exact provider/model routing, emit `accepted` only after a real receipt, return promptly with a `done` promise, reject that promise for transport/execution failures, and stop/reap only its owned runtime. It must not expand the checkpoint's permissions or auto-approve user decisions. Emit concise metadata; avoid raw tool arguments, secrets, or unrestricted logs. An ended turn is not proof of acceptance criteria.

Events: `accepted`, `running`, `waiting_user`, `log`, `ended`. Accepted events carry `receipt` and `sessionId`. Ended events carry final text and optional `reportedComplete`; only the separate verification path can claim verified acceptance.

The first release includes a DeepSeek Harness SDK adapter and transport fixtures. Qoder CN and ZCode need separately implemented/tested adapters. Do not advertise either as working merely because the configuration can hold their names.
