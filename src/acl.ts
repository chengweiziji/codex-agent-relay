import { spawnSync } from 'node:child_process';
import { childEnv } from './rpc.ts';
import { join } from 'node:path';

// DSH's Windows sandbox provisions a standing write grant by editing the workspace
// DACL and mandatory label. That needs effective WRITE_DAC and WRITE_OWNER for the
// signed-in user; without both, the receiver fails before running any tool. This is
// a read-only preflight: a failed check never modifies permissions.
const script = String.raw`
$ErrorActionPreference = 'Stop'
$path = $env:RELAY_ACL_PATH
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class RelayAccess {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
}
"@
# Opening an existing directory with these rights asks Windows to evaluate the
# current token and complete DACL. No write, ACL change or ownership change occurs.
$handle = [RelayAccess]::CreateFile($path, 0xC0000, 7, [IntPtr]::Zero, 3, 0x02000000, [IntPtr]::Zero)
try { [pscustomobject]@{ ok = (-not $handle.IsInvalid) } | ConvertTo-Json -Compress }
finally { $handle.Dispose() }

`;

export interface AclPreflight {
  ok: boolean;
  detail: string;
}

export function windowsWorkspaceAcl(cwd: string): AclPreflight {
  if (process.platform !== 'win32') return { ok: true, detail: 'not applicable on this platform' };
  const powershell = process.env.SystemRoot ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell.exe';
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    env: childEnv({ command: powershell, args: [], env: { RELAY_ACL_PATH: cwd } }),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20_000,
  });
  if (result.error) return { ok: false, detail: `permission preflight could not run (${result.error.message})` };
  if (result.status !== 0) return { ok: false, detail: `permission preflight could not read the folder permissions (exit ${result.status})` };
  let parsed: any;
  try { parsed = JSON.parse(String(result.stdout).trim()); }
  catch { return { ok: false, detail: 'permission preflight returned an unexpected result' }; }
  return parsed?.ok === true
    ? { ok: true, detail: 'the signed-in user has effective change-permissions and take-ownership on the folder' }
    : { ok: false, detail: 'the signed-in user lacks effective change-permissions or take-ownership on the folder' };
}
