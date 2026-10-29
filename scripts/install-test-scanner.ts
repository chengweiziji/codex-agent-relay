import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Official v8.30.1 release checksums. This installs only an isolated CI test tool.
const assets: Record<string, [string, string]> = {
  'win32-x64': ['windows_x64.zip', 'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e'],
  'linux-x64': ['linux_x64.tar.gz', '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'],
  'darwin-arm64': ['darwin_arm64.tar.gz', 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5'],
  'darwin-x64': ['darwin_x64.tar.gz', 'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709'],
};
const asset = assets[`${process.platform}-${process.arch}`];
if (!asset) throw Error('Unsupported test-scanner platform');
const name = `gitleaks_8.30.1_${asset[0]}`;
const response = await fetch(`https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/${name}`, { signal: AbortSignal.timeout(60000) });
if (!response.ok) throw Error(`Scanner download failed: HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== asset[1]) throw Error('Scanner release checksum mismatch');
const dir = mkdtempSync(join(tmpdir(), 'relay-scanner-')), archive = join(dir, name), output = join(dir, 'bin');
mkdirSync(output); writeFileSync(archive, bytes);
const binary = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks';
execFileSync('tar', ['-xf', archive, '-C', output, binary], { windowsHide: true, timeout: 30000 });
const path = join(output, binary); if (process.platform !== 'win32') chmodSync(path, 0o700);
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `RELAY_TEST_GITLEAKS=${path}\n`);
console.log(JSON.stringify({ version: '8.30.1', path, sha256Verified: true }));
