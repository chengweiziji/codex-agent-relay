import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

// A process group on POSIX; Windows uses taskkill /T. This is containment for
// cleanup, not a filesystem/network sandbox. Deliberately detached descendants
// require an OS sandbox/Job Object and are not claimed to be contained here.
export async function terminateTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    try { await exec('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 8000 }); }
    catch { throw Error('Process-tree termination could not be confirmed; inspect descendants before recovery'); }
  } else {
    try { process.kill(-pid, 'SIGKILL'); }
    catch (e: any) { if (e.code !== 'ESRCH') throw e; }
  }
}
