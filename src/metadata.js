import { execFileSync } from 'node:child_process';
import { relative, resolve } from 'node:path';

function call(command, args, cwd) {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 }).trim();
  } catch { return null; }
}

export function codexVersion() {
  return call('codex', ['--version'], process.cwd());
}

export function gitState(cwd, { excludePaths = [] } = {}) {
  if (call('git', ['rev-parse', '--is-inside-work-tree'], cwd) !== 'true') return { commit: null, dirty: null };
  const commit = call('git', ['rev-parse', 'HEAD'], cwd);
  const status = call('git', ['status', '--porcelain', '--untracked-files=all'], cwd);
  const excluded = excludePaths.map(path => relative(cwd, resolve(path)).replaceAll('\\', '/')).filter(path => path && path !== '..' && !path.startsWith('../'));
  const entries = (status ?? '').split(/\r?\n/).filter(Boolean).filter(line => {
    const path = line.slice(3).replaceAll('\\', '/').replace(/^"/, '');
    return !/(?:^|\/)\.agentlens\//.test(path) && !excluded.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
  });
  return { commit, dirty: entries.length > 0 };
}

export function coverageFor(before, after) {
  const details = snapshot => snapshot ? {
    captured: snapshot.captured ?? snapshot.files?.size ?? 0,
    skipped: snapshot.skipped ?? 0,
    bytes: snapshot.bytes ?? 0,
    skippedReasons: snapshot.skippedReasons ?? {}
  } : null;
  return { status: before && after ? 'captured' : 'unavailable', before: details(before), after: details(after) };
}
