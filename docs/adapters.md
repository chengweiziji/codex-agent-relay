# Extending Agent Relay

Adapters are trusted user-installed code, loaded only from absolute module paths in the **user** configuration. Project config cannot install or select arbitrary executable code.

Implement `AgentAdapter` from `src/types.ts` and default-export an instance:

```ts
interface AgentAdapter {
  validate(config: ProjectConfig, launch: LaunchConfig): void;
  preflight?(cwd: string): void;
  start(job: Job, launch: LaunchConfig, emit: (event: AdapterEvent) => void): AgentRun;
}
interface AgentRun {
  done: Promise<void>;
  stop(): Promise<void>;
}
```

Register it under `adapterModules` and a same-named `agents` launch entry, restart the service, then select its ID in a project's config. Unsupported Agent IDs fail; they do not silently use DeepSeek.

The adapter must validate exact provider/model routing, verify what the receiver actually runs before emitting `accepted`, return promptly with a `done` promise, reject that promise for transport/execution failures, and stop/reap only its owned runtime. `preflight` runs after all quota, secret and ownership checks but before a job is created; use it for read-only environment checks such as the Windows permission preflight and never to modify the environment. The adapter must not expand the checkpoint's permissions or auto-approve user decisions. Emit concise metadata; avoid raw tool arguments, secrets, or unrestricted logs. An ended turn is not proof of acceptance criteria.

Events: `accepted`, `running`, `waiting_user`, `log`, `ended`. Accepted events carry `receipt` and `sessionId`. Ended events carry final text and optional `reportedComplete`. `relay_verify` records user-supplied evidence only; no code path marks a job as “passed”.

The bundled `deepseek-harness` adapter uses the SDK stdio transport with the `sdk` profile. It emits `accepted` only after both the durable prompt receipt and runtime attestation: `request/header`/`request/context` must name the approved provider and model, `sandbox/mode` must be `workspace-write`, and `approval/policy` must be `ask` or `never`. Child sessions announced by `subagent.started` are checked for route drift, but only the main session can satisfy acceptance: child events never stand in for the main session's route, sandbox or approval-policy attestation. A mismatch requests process-tree termination. Events are observed after enqueue; this is not a receiver-side execution barrier and cannot guarantee that no request or tool call occurred before termination. On Windows it also requires the signed-in user to hold effective change-permissions and take-ownership on the workspace; otherwise it refuses before spawning the receiver, rather than letting the sandbox fail later. The receiver confines writes and deletes to the workspace but does not isolate reads, network access or process visibility, and it has no interactive approval channel, so the relay never grants approval; observed approval requests or decisions fail the run pending user review. Qoder CN and ZCode need separately implemented and tested adapters. Do not advertise them as working merely because the configuration can hold their names.
