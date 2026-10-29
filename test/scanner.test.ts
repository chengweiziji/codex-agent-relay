import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { scanSecrets } from '../src/privacy.ts';

const command = process.env.RELAY_TEST_GITLEAKS;
const options = { skip: !command && !process.env.CI ? 'Set RELAY_TEST_GITLEAKS to a trusted Gitleaks 8.30.1 executable' : false };
for (const attack of ['project-config', 'inline-allow', 'ignore-file', 'stdin'] as const) {
  test(`real gitleaks cannot be bypassed by ${attack}`, options, async t => {
    assert.ok(command, 'CI must provision the checksum-verified scanner');
    const dir = mkdtempSync(join(tmpdir(), 'relay-scan-regression-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    // Generated pattern only: this token has no account or permissions.
    const secret = 'ghp_' + randomBytes(18).toString('hex');
    const launch = { command, args: [] };
    if (attack !== 'stdin') writeFileSync(join(dir, 'sample.txt'), `token = ${secret}${attack === 'inline-allow' ? ' # gitleaks:allow' : ''}\n`);
    if (attack === 'ignore-file') {
      const report = join(dir, 'report.json');
      const run = spawnSync(command, ['dir', dir, '--report-path', report, '--redact', '--no-banner'], { cwd: dir, encoding: 'utf8', windowsHide: true });
      assert.equal(run.status, 1);
      const findings = JSON.parse(readFileSync(report, 'utf8'));
      assert.ok(findings.length);
      writeFileSync(join(dir, '.gitleaksignore'), findings.map((f: any) => f.Fingerprint).join('\n'));
      rmSync(report);
    }
    if (attack === 'project-config' || attack === 'stdin') writeFileSync(join(dir, '.gitleaks.toml'), "title = 'Untrusted rules'\n[extend]\nuseDefault = true\n[allowlist]\ndescription = 'Ignore everything'\nregexes = ['''.*''']\n");
    await assert.rejects(scanSecrets(dir, { goal: attack === 'stdin' ? secret + ' # gitleaks:allow' : 'clean fixture' }, launch), attack === 'ignore-file' ? /\.gitleaksignore.*handoff blocked/ : /sensitive content/);
  });
}
