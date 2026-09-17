import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyze } from '../src/analyze.js';
import { writeHtml } from '../src/render.js';
import { writeComparisonHtml } from '../src/compare-render.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const docs = join(root, 'docs');
mkdirSync(docs, { recursive: true });
const start = Date.parse('2026-09-17T10:42:15.000Z');
const at = seconds => new Date(start + seconds * 1000).toISOString();
const raw = [
  { at: at(0), event: { type: 'thread.started', thread_id: 'demo-agentlens-2026' } },
  { at: at(1), event: { type: 'turn.started' } },
  { at: at(3), event: { type: 'item.started', item: { id: 'cmd1', type: 'command_execution', command: 'rg --files src tests', status: 'in_progress' } } },
  { at: at(5), event: { type: 'item.completed', item: { id: 'cmd1', type: 'command_execution', command: 'rg --files src tests', aggregated_output: 'src/cache.ts\nsrc/client.ts\ntests/cache.test.ts', exit_code: 0, status: 'completed' } } },
  { at: at(7), event: { type: 'item.started', item: { id: 'cmd2', type: 'command_execution', command: 'cat src/cache.ts', status: 'in_progress' } } },
  { at: at(8), event: { type: 'item.completed', item: { id: 'cmd2', type: 'command_execution', command: 'cat src/cache.ts', aggregated_output: 'export function getCached(key: string) {\n  return store.get(key);\n}', exit_code: 0, status: 'completed' } } },
  { at: at(10), event: { type: 'item.started', item: { id: 'cmd3', type: 'command_execution', command: 'rg "getCached|invalidate" src tests', status: 'in_progress' } } },
  { at: at(12), event: { type: 'item.completed', item: { id: 'cmd3', type: 'command_execution', command: 'rg "getCached|invalidate" src tests', aggregated_output: 'src/cache.ts:4:export function getCached(key: string)\ntests/cache.test.ts:12:expect(getCached("a"))', exit_code: 0, status: 'completed' } } },
  { at: at(17), event: { type: 'item.completed', item: { id: 'edit1', type: 'file_change', changes: [{ path: 'src/cache.ts', kind: 'update' }], status: 'completed' } } },
  { at: at(24), event: { type: 'item.completed', item: { id: 'edit2', type: 'file_change', changes: [{ path: 'tests/cache.test.ts', kind: 'update' }], status: 'completed' } } },
  { at: at(30), event: { type: 'item.started', item: { id: 'cmd4', type: 'command_execution', command: 'npm test -- --runInBand', status: 'in_progress' } } },
  { at: at(42), event: { type: 'item.completed', item: { id: 'cmd4', type: 'command_execution', command: 'npm test -- --runInBand', aggregated_output: 'PASS tests/cache.test.ts\n  ✓ expires stale entries\n  ✓ invalidates by key\n\nTests: 2 passed, 2 total', exit_code: 0, status: 'completed' } } },
  { at: at(45), event: { type: 'item.completed', item: { id: 'msg1', type: 'agent_message', text: 'Fixed cache invalidation and added regression coverage. Both tests pass.' } } },
  { at: at(48), event: { type: 'turn.completed', usage: { input_tokens: 12480, cached_input_tokens: 5942, output_tokens: 1876, reasoning_output_tokens: 1124 } } }
];
const changes = [
  { path: 'src/cache.ts', status: 'modified', additions: 5, deletions: 2, diff: '--- a/src/cache.ts\n+++ b/src/cache.ts\n@@ -1,5 +1,8 @@\n export function getCached(key: string) {\n-  return store.get(key);\n+  const entry = store.get(key);\n+  if (!entry || entry.expiresAt < Date.now()) {\n+    store.delete(key);\n+    return undefined;\n+  }\n+  return entry.value;\n }' },
  { path: 'tests/cache.test.ts', status: 'modified', additions: 8, deletions: 0, diff: '--- a/tests/cache.test.ts\n+++ b/tests/cache.test.ts\n@@ -8,3 +8,11 @@\n describe("cache", () => {\n+  it("expires stale entries", () => {\n+    setCached("a", 1, -1);\n+    expect(getCached("a")).toBeUndefined();\n+  });\n+  it("invalidates by key", () => {\n+    setCached("a", 1, 100);\n+    invalidate("a");\n+    expect(getCached("a")).toBeUndefined();\n+  });\n });' }
];
const demo = analyze(raw, changes, {
  id: 'demo-cache-fix', agent: 'codex', prompt: 'Fix cache invalidation and add a regression test',
  cwd: '/workspace/atlas', startedAt: at(0), endedAt: at(49), exitCode: 0, demo: true,
  model: 'demo-model', codexVersion: 'synthetic', sandbox: 'workspace-write',
  platform: { os: 'linux', arch: 'x64' }, gitCommit: null, dirtyBefore: false, dirtyAfter: true,
  captureCoverage: {
    status: 'captured',
    before: { captured: 42, skipped: 1, bytes: 113512, skippedReasons: { binary: 1 } },
    after: { captured: 42, skipped: 1, bytes: 113690, skippedReasons: { binary: 1 } }
  }
});
writeFileSync(join(docs, 'demo-session.json'), JSON.stringify(demo, null, 2) + '\n');
writeHtml(demo, join(docs, 'index.html'), { mode: 'redacted' });

const failedRaw = [
  { at: at(3600), event: { type: 'thread.started', thread_id: 'demo-agentlens-compare' } },
  { at: at(3601), event: { type: 'turn.started' } },
  { at: at(3603), event: { type: 'item.completed', item: { id: 'b-cmd1', type: 'command_execution', command: 'rg --files src tests', aggregated_output: 'src/cache.ts\nsrc/client.ts\ntests/cache.test.ts', exit_code: 0, status: 'completed' } } },
  { at: at(3607), event: { type: 'item.completed', item: { id: 'b-cmd2', type: 'command_execution', command: 'cat src/cache.ts', aggregated_output: 'export function getCached(key: string) {\n  return store.get(key);\n}', exit_code: 0, status: 'completed' } } },
  { at: at(3610), event: { type: 'item.completed', item: { id: 'b-cmd3', type: 'command_execution', command: 'cat src/client.ts', aggregated_output: 'export const client = createClient({ cache: true });', exit_code: 0, status: 'completed' } } },
  { at: at(3618), event: { type: 'item.completed', item: { id: 'b-edit1', type: 'file_change', changes: [{ path: 'src/cache.ts', kind: 'update' }], status: 'completed' } } },
  { at: at(3627), event: { type: 'item.completed', item: { id: 'b-cmd4', type: 'command_execution', command: 'npm test -- --runInBand', aggregated_output: 'FAIL tests/cache.test.ts\n  ✕ expires stale entries\n  Expected: undefined\n  Received: 1\n\nTests: 1 failed, 1 passed, 2 total', exit_code: 1, status: 'completed' } } },
  { at: at(3634), event: { type: 'item.completed', item: { id: 'b-msg1', type: 'agent_message', text: 'The cache patch did not handle expired entries. The regression test is still failing.' } } },
  { at: at(3636), event: { type: 'turn.completed', usage: { input_tokens: 14120, cached_input_tokens: 6020, output_tokens: 2045, reasoning_output_tokens: 980 } } }
];
const failedChanges = [{
  path: 'src/cache.ts', status: 'modified', additions: 2, deletions: 1,
  diff: '--- a/src/cache.ts\n+++ b/src/cache.ts\n@@ -1,3 +1,4 @@\n export function getCached(key: string) {\n-  return store.get(key);\n+  const entry = store.get(key);\n+  return entry?.value;\n }'
}];
const failed = analyze(failedRaw, failedChanges, {
  id: 'demo-cache-failed', agent: 'codex', prompt: demo.prompt,
  cwd: demo.cwd, startedAt: at(3600), endedAt: at(3640), exitCode: 1, outcome: 'failed', demo: true,
  model: demo.model, codexVersion: demo.codexVersion, sandbox: demo.sandbox,
  platform: demo.platform, gitCommit: demo.gitCommit, dirtyBefore: false, dirtyAfter: true,
  captureCoverage: demo.captureCoverage
});
writeFileSync(join(docs, 'demo-failed-session.json'), JSON.stringify(failed, null, 2) + '\n');
writeComparisonHtml(demo, failed, join(docs, 'compare.html'));
console.log(`Built demos at ${join(docs, 'index.html')} and ${join(docs, 'compare.html')}`);
