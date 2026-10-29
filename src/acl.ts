import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// DSH's Windows sandbox provisions a standing write grant by editing the workspace
// DACL and mandatory label. That needs effective WRITE_DAC and WRITE_OWNER for the
// signed-in user; without both, the receiver fails before running any tool. This is
// a read-only preflight: a failed check never modifies permissions.
const script = String.raw`
$ErrorActionPreference = 'Stop'
$path = $env:RELAY_ACL_PATH
$id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [System.Security.Principal.WindowsPrincipal]::new($id)
$sid = $id.User
$acl = [System.IO.Directory]::GetAccessControl($path, [System.Security.AccessControl.AccessControlSections]::Access)
$rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
$allow = [System.Security.AccessControl.FileSystemRights]0
foreach ($rule in $rules) {
  if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
  $matches = $rule.IdentityReference -eq $sid
  if (-not $matches) { $matches = $principal.IsInRole($rule.IdentityReference) }
  if ($matches) { $allow = $allow -bor $rule.FileSystemRights }
}
$need = [System.Security.AccessControl.FileSystemRights]'ChangePermissions, TakeOwnership'
[pscustomobject]@{ ok = (($allow -band $need) -eq $need); effective = [string]$allow } | ConvertTo-Json -Compress
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
    env: { ...process.env, RELAY_ACL_PATH: cwd },
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
