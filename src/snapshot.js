import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const OMIT = new Set(['.git', '.agentlens', 'node_modules', '.next', 'dist', 'build', 'coverage', '.venv', 'venv']);
const FILE_LIMIT = 1024 * 1024;
const TOTAL_LIMIT = 40 * 1024 * 1024;
const COUNT_LIMIT = 4000;

function fileList(cwd) {
  try {
    const result = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd, encoding: 'buffer', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    return result.toString('utf8').split('\0').filter(Boolean).filter(path => !path.split(/[\\/]/).some(part => OMIT.has(part)));
  } catch {
    const found = [];
    function visit(dir) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (OMIT.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) visit(full);
        else if (entry.isFile()) found.push(relative(cwd, full));
      }
    }
    visit(cwd);
    return found;
  }
}

export function takeSnapshot(cwd, { excludePaths = [] } = {}) {
  const files = new Map();
  let total = 0;
  const skippedReasons = { countLimit: 0, fileSize: 0, totalSize: 0, binary: 0, unreadable: 0 };
  const excluded = excludePaths.map(path => relative(cwd, resolve(path)).replaceAll('\\', '/')).filter(path => path && path !== '..' && !path.startsWith('../'));
  for (const path of fileList(cwd).sort()) {
    const normalized = path.replaceAll('\\', '/');
    if (excluded.some(prefix => normalized === prefix || normalized.startsWith(`${prefix}/`))) continue;
    if (files.size >= COUNT_LIMIT) { skippedReasons.countLimit++; continue; }
    try {
      const full = resolve(cwd, path);
      const size = statSync(full).size;
      if (size > FILE_LIMIT) { skippedReasons.fileSize++; continue; }
      if (total + size > TOTAL_LIMIT) { skippedReasons.totalSize++; continue; }
      const data = readFileSync(full);
      if (data.includes(0)) { skippedReasons.binary++; continue; }
      files.set(normalized, data);
      total += data.length;
    } catch { skippedReasons.unreadable++; }
  }
  return { files, captured: files.size, skipped: Object.values(skippedReasons).reduce((sum, count) => sum + count, 0), skippedReasons, bytes: total };
}

function patchFor(path, before, after) {
  const temp = mkdtempSync(join(tmpdir(), 'agentlens-diff-'));
  try {
    const a = join(temp, 'before');
    const b = join(temp, 'after');
    writeFileSync(a, before ?? '');
    writeFileSync(b, after ?? '');
    let patch = '';
    try {
      patch = execFileSync('git', ['-c', 'core.autocrlf=false', 'diff', '--no-index', '--no-ext-diff', '--unified=3', '--', a, b], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      patch = error.stdout?.toString() ?? '';
    }
    const lines = patch.replaceAll('\r\n', '\n').split('\n');
    const firstHunk = lines.findIndex(line => line.startsWith('@@'));
    const body = firstHunk >= 0 ? lines.slice(firstHunk).join('\n') : '';
    return `--- a/${path}\n+++ b/${path}\n${body}`.slice(0, 60000);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function compareSnapshots(before, after) {
  const changes = [];
  const paths = new Set([...before.files.keys(), ...after.files.keys()]);
  for (const path of [...paths].sort()) {
    const oldData = before.files.get(path);
    const newData = after.files.get(path);
    if (oldData?.equals(newData)) continue;
    const status = oldData === undefined ? 'added' : newData === undefined ? 'deleted' : 'modified';
    const diff = patchFor(path, oldData, newData);
    const lines = diff.split('\n');
    changes.push({
      path, status, diff,
      additions: lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length,
      deletions: lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length
    });
  }
  return changes;
}
