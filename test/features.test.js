import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze } from '../src/analyze.js';
import { inferViewedFiles } from '../src/analyze.js';
import { compareRuns } from '../src/compare.js';
import { runCodex } from '../src/cli.js';
import { readRecordedEvents, recoverRun } from '../src/recover.js';
import { redactSession } from '../src/redact.js';
import { renderHtml } from '../src/render.js';
import { takeSnapshot } from '../src/snapshot.js';

const fixture = new URL('./fixtures/codex-run.jsonl', import.meta.url);
const expected = JSON.parse(readFileSync(new URL('./fixtures/expected-analysis.json', import.meta.url), 'utf8'));

test('normalizes synthetic Codex JSONL to the golden summary and exports HTML', () => {
  const { events } = readRecordedEvents(fixture);
  const session = analyze(events, [], { startedAt: events[0].at, endedAt: events.at(-1).at });
  assert.deepEqual({
    threadId: session.threadId, commands: session.stats.commands,
    inputTokens: session.usage.input_tokens, outputTokens: session.usage.output_tokens,
    command: session.timeline[0].command, output: session.timeline[0].output
  }, expected);
  assert.match(renderHtml(session, { mode: 'redacted' }), /SHARE SAFE|share-mode/);
  assert.equal(session.schemaVersion, 1);
  assert.deepEqual(inferViewedFiles(expected.command), ['src/中文 文件.ts']);
});

test('redacted HTML removes secrets, env output, home path, and raw embedded payload', () => {
  const secret = 'sk-proj-abcdefghijklmnopqrstuv';
  const session = {
    id: 'sample', cwd: 'C:\\Users\\alice\\private', prompt: `Use ${secret}\nPUBLIC_URL=internal-host`,
    timeline: [{ id: '1', kind: 'command', title: 'Command executed', command: 'Get-Content .env', output: 'API_KEY=hidden-value\nDEBUG=1' }],
    changes: [{ path: '.env', diff: '+PASSWORD=another-secret' }],
    viewedFiles: [], usage: {}, stats: {}
  };
  const redacted = redactSession(session, { home: 'C:\\Users\\alice', username: 'alice' });
  assert.equal(redacted.timeline[0].output, '[REDACTED .env OUTPUT]');
  assert.equal(redacted.changes[0].diff, '[REDACTED .env PATCH]');
  assert.doesNotMatch(JSON.stringify(redacted), /hidden-value|another-secret|alice|abcdefghijklmnopqrstuv|internal-host/);
  const safeHtml = renderHtml(session, { mode: 'redacted' });
  assert.doesNotMatch(safeHtml, /hidden-value|another-secret|alice|abcdefghijklmnopqrstuv|internal-host/);
  assert.match(safeHtml, /REDACTED \.env OUTPUT/);
  const rawHtml = renderHtml(session);
  const share = rawHtml.match(/<script id="share-html"[^>]*>([^<]+)<\/script>/)?.[1];
  assert.ok(share);
  const oneClickExport = Buffer.from(share, 'base64').toString('utf8');
  assert.equal(oneClickExport, safeHtml);
});

test('recover tolerates a truncated event line and marks patch coverage unavailable', () => {
  const output = mkdtempSync(join(tmpdir(), 'agentlens-recover-'));
  try {
    writeFileSync(join(output, 'events.jsonl'), readFileSync(fixture, 'utf8') + '{"at":');
    writeFileSync(join(output, 'meta.json'), JSON.stringify({ id: 'recovery-test', prompt: 'Inspect repository', startedAt: '2026-01-01T00:00:00.000Z' }));
    const result = recoverRun(output);
    assert.equal(result.session.outcome, 'recovered');
    assert.equal(result.session.recovery.malformedLines, 1);
    assert.equal(result.session.stats.commands, 1);
    assert.equal(result.session.captureCoverage.status, 'unavailable');
    assert.ok(existsSync(result.htmlPath));
  } finally { rmSync(output, { recursive: true, force: true }); }
});

test('compare identifies the first changed event, file sets, patches, and token delta', () => {
  const a = { id: 'a', timeline: [{ kind: 'command', command: 'cat a.ts' }], viewedFiles: ['a.ts'], changes: [{ path: 'a.ts', diff: '+1' }], usage: { input_tokens: 10, output_tokens: 5 } };
  const b = { id: 'b', timeline: [{ kind: 'command', command: 'cat b.ts' }], viewedFiles: ['b.ts'], changes: [{ path: 'b.ts', diff: '+2' }], usage: { input_tokens: 15, output_tokens: 5 } };
  const report = compareRuns(a, b);
  assert.equal(report.firstDifference.index, 0);
  assert.deepEqual(report.viewedFiles.onlyA, ['a.ts']);
  assert.deepEqual(report.patches.onlyB, ['b.ts']);
  assert.deepEqual(report.patchLines.delta, { additions: 0, deletions: 0 });
  assert.equal(report.tokens.delta.total, 5);
});

test('captures a non-Git directory containing spaces and Chinese file names', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentlens 空格 '));
  try {
    writeFileSync(join(cwd, '中文 文件.txt'), 'hello');
    const snapshot = takeSnapshot(cwd);
    assert.equal(snapshot.captured, 1);
    assert.ok(snapshot.files.has('中文 文件.txt'));
    assert.equal(snapshot.skipped, 0);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

for (const [signal, expectedExit] of [['SIGINT', 130], ['SIGTERM', 143]]) test(`${signal} finalizes an interrupted session instead of losing the replay`, async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentlens-signal-'));
  const oldExitCode = process.exitCode;
  try {
    writeFileSync(join(cwd, 'file.txt'), 'original');
    const fakeLaunch = () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = signal => { child.stdout.end(); child.stderr.end(); setImmediate(() => child.emit('close', null, signal)); return true; };
      setTimeout(() => {
        child.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'interrupt-test' }) + '\n');
        process.emit(signal);
      }, 20);
      return child;
    };
    const output = join(cwd, 'recording');
    const session = await runCodex(['--cwd', cwd, '--output', output, '--no-open', '--', 'Inspect file.txt'], { launch: fakeLaunch });
    assert.equal(session.outcome, 'interrupted');
    assert.equal(session.exitCode, expectedExit);
    assert.equal(session.threadId, 'interrupt-test');
    assert.equal(session.stats.filesChanged, 0);
    assert.ok(existsSync(join(output, 'session.json')));
    assert.ok(existsSync(join(output, 'index.html')));
  } finally {
    process.exitCode = oldExitCode;
    rmSync(cwd, { recursive: true, force: true });
  }
});
