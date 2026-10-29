import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function fixture(api: (name: string, input: any) => Promise<any>) {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  // Execute the shipped form controller with a tiny DOM, not a duplicate implementation.
  const controller = source.slice(source.indexOf('let configRequest='), source.indexOf("$('jobs').onchange="));
  const button = { disabled: false };
  const fields: any = { project: { value: 'A' }, saved: { textContent: '' }, 'config-form': { querySelector: () => button } };
  for (const key of ['agent','provider','model','threshold','bucket','enabled']) fields[key] = { value: 'OLD_' + key, checked: true, disabled: false };
  const errors: any[] = [];
  const context: any = { $: (id: string) => fields[id], api, showError: (e: any) => errors.push(e) };
  runInNewContext(controller, context);
  return { fields, button, context, errors };
}
test('revoked project clears all prior target fields and disables automatic opt-in', async () => {
  const { fields, button, context } = fixture(async () => null);
  fields.project.value = 'B'; await context.loadConfig();
  for (const key of ['agent','provider','model']) assert.equal(fields[key].value, '');
  assert.equal(fields.enabled.checked, false); assert.equal(button.disabled, false);
  assert.match(fields.saved.textContent, /revoked/);
});
test('late response for project A cannot populate project B settings', async () => {
  const pending: Record<string, (value: any) => void> = {};
  const { fields, button, context } = fixture(async (_, input) => new Promise(resolve => { pending[input.project] = resolve; }));
  const first = context.loadConfig(); assert.equal(button.disabled, true);
  fields.project.value = 'B'; const second = context.loadConfig();
  pending.B(null); await second;
  pending.A({ agent: 'AGENT_A', provider: 'PROVIDER_A', model: 'MODEL_A', enabled: true }); await first;
  assert.equal(fields.model.value, ''); assert.equal(fields.enabled.checked, false);
});
test('failed project load leaves target fields cleared and save disabled', async () => {
  const { fields, button, context, errors } = fixture(async () => { throw Error('Offline'); });
  await context.loadConfig(); assert.equal(button.disabled, true); assert.equal(fields.model.value, ''); assert.equal(errors.length, 1);
});
