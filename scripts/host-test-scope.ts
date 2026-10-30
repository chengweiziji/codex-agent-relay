import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { canonical, pathKey, readJSON, findProject } from '../src/config.ts';

// This marker is created deliberately for a disposable acceptance workspace.
// Never create it automatically in an existing production relay home.
export function validateHostTestScope(home: string): string {
  if (pathKey(home) === pathKey(join(homedir(), '.codex-agent-relay'))) throw Error('Production relay home cannot use simulated quota');
  const marker = readJSON<any>(join(home, 'host-test.json'), null);
  if (marker?.purpose !== 'disposable-host-acceptance' || typeof marker.project !== 'string' || !isAbsolute(marker.project)) throw Error('Isolated host-test.json marker with an absolute project path required');
  const project = canonical(marker.project);
  const records = Object.values(readJSON<Record<string, any>>(join(home, 'trusted-projects.json'), {}));
  if (records.length !== 1 || records[0].path !== pathKey(project) || !findProject(project, home)?.config.enabled) throw Error('Simulated quota requires exactly one approved test project');
  const state = readJSON<any>(join(home, 'state.json'), { tasks: [], jobs: [] });
  if ([...state.tasks, ...state.jobs].some(item => pathKey(item.cwd) !== pathKey(project))) throw Error('Relay history contains another project');
  return project;
}
