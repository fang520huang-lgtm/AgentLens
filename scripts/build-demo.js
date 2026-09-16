import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyze } from '../src/analyze.js';
import { writeHtml } from '../src/render.js';

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
  cwd: '/workspace/atlas', startedAt: at(0), endedAt: at(49), exitCode: 0, demo: true
});
writeFileSync(join(docs, 'demo-session.json'), JSON.stringify(demo, null, 2) + '\n');
writeHtml(demo, join(docs, 'index.html'));
console.log(`Built demo at ${join(docs, 'index.html')}`);
