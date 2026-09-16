import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze, inferViewedFiles } from '../src/analyze.js';
import { compareSnapshots, takeSnapshot } from '../src/snapshot.js';
import { renderHtml } from '../src/render.js';

test('coalesces Codex events and totals token usage across turns', () => {
  const raw = [
    { at: '2026-01-01T00:00:00Z', event: { type: 'item.started', item: { id: '1', type: 'command_execution', command: 'cat src/app.ts' } } },
    { at: '2026-01-01T00:00:02Z', event: { type: 'item.completed', item: { id: '1', type: 'command_execution', aggregated_output: 'hello', exit_code: 0 } } },
    { at: '2026-01-01T00:00:03Z', event: { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 3 } } },
    { at: '2026-01-01T00:00:04Z', event: { type: 'turn.completed', usage: { input_tokens: 7, output_tokens: 2 } } }
  ];
  const result = analyze(raw, [], { startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:00:05Z' });
  assert.equal(result.stats.commands, 1);
  assert.deepEqual(result.viewedFiles, ['src/app.ts']);
  assert.equal(result.timeline[0].output, 'hello');
  assert.equal(result.usage.input_tokens, 17);
  assert.equal(result.usage.output_tokens, 5);
  assert.equal(result.durationMs, 5000);
  assert.deepEqual(inferViewedFiles('npm test'), []);
  assert.deepEqual(inferViewedFiles('"C:\\tools\\pwsh.exe" -Command \'Get-Content -LiteralPath hello.txt -Raw\''), ['hello.txt']);
});

test('captures edits without including previous workspace content in the patch', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentlens-test-'));
  try {
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src', 'app.ts'), 'const answer = 1;\n');
    const before = takeSnapshot(cwd);
    writeFileSync(join(cwd, 'src', 'app.ts'), 'const answer = 2;\n');
    writeFileSync(join(cwd, 'src', 'new.ts'), 'export const added = true;\n');
    const changes = compareSnapshots(before, takeSnapshot(cwd));
    assert.deepEqual(changes.map(change => change.path), ['src/app.ts', 'src/new.ts']);
    assert.match(changes[0].diff, /-const answer = 1;/);
    assert.match(changes[0].diff, /\+const answer = 2;/);
    assert.equal(changes[1].status, 'added');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('exports a self-contained HTML replay and safely embeds event text', () => {
  const html = renderHtml({ id: 'test', timeline: [{ id: '1', kind: 'message', title: 'Agent response', detail: '</script><script>alert(1)</script>' }], changes: [], viewedFiles: [], usage: {}, stats: {} });
  assert.match(html, /<style>.*\.app-shell/s);
  assert.match(html, /const session = JSON\.parse/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /\\u003c\/script\\u003e/);
});
