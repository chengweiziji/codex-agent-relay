import { createInterface } from 'node:readline';
import { call } from './client.ts';
import { redact } from './config.ts';

const string = { type: 'string' };
const array = { type: 'array', items: string };
const cpProperties = { goal: string, completed: array, remaining: array, decisions: array, files: array, tests: array, processes: array, permissions: string, acceptance: array };
const checkpoint = { type: 'object', properties: cpProperties, required: Object.keys(cpProperties), additionalProperties: false };
const definitions = [
  ['setup', 'Open the local first-time setup or model settings page. The user chooses the Agent and model; this does not run a model or enable Hooks.', { cwd: string }, []],
  ['register', 'Register an active execution task in an enabled project. Use the hook-supplied Codex session ID.', { cwd: string, sessionId: string, checkpoint, mode: string }, ['cwd','sessionId','checkpoint']],
  ['checkpoint', 'Save current goal, remaining steps, tests, permissions and existing processes before handoff.', { taskId: string, checkpoint, backgroundToolIds: array }, ['taskId','checkpoint']],
  ['handoff', 'Start a real external Agent handoff once quota is low. Returns the real receipt/state and dashboardUrl. Stop executing the source task afterwards.', { taskId: string, instruction: string }, ['taskId','instruction']],
  ['status', 'Read live relay status and persisted results. No model calls are made.', { jobId: string }, []],
  ['finish', 'Mark a task complete only after its acceptance criteria are met; suppress future handoff.', { taskId: string }, ['taskId']],
  ['task_state', 'Pause, await user input, or resume an undispatched execution task. Never resume Plan mode autonomously.', { taskId: string, state: { type: 'string', enum: ['active','paused','waiting_user','completed'] } }, ['taskId','state']],
  ['verify', 'Record supplied evidence only. This does not execute acceptance commands or certify acceptance.', { jobId: string, evidence: array }, ['jobId','evidence']],
] as const;
export const mcpTools = definitions.map(([name, description, properties, required]) => ({ name: `relay_${name}`, description,
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
  annotations: { readOnlyHint: name === 'status', destructiveHint: name === 'handoff', idempotentHint: true, openWorldHint: name === 'handoff' } }));
export async function runMcp(): Promise<void> {
  const write = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + '\n');
  for await (const line of createInterface({ input: process.stdin })) {
    let message: any; try { message = JSON.parse(line); } catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    if (message.id == null) continue;
    void (async () => {
      try {
        let result: any;
        if (message.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'codex-agent-relay', version: '0.1.0' } };
        else if (message.method === 'ping') result = {};
        else if (message.method === 'tools/list') result = { tools: mcpTools };
        else if (message.method === 'tools/call') {
          const name = message.params?.name;
          if (!mcpTools.some(t => t.name === name)) throw Error('Unknown tool');
          try { const value = await call(name.slice(6), message.params.arguments || {}); result = { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false }; }
          catch (e: any) { result = { content: [{ type: 'text', text: redact(e.message) }], isError: true }; }
        } else { write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }); return; }
        write({ jsonrpc: '2.0', id: message.id, result });
      } catch (e: any) { write({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: redact(e.message) } }); }
    })();
  }
}
